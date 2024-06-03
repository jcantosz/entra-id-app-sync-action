const { DefaultAzureCredential } = require("@azure/identity");
const {
  TokenCredentialAuthenticationProvider,
} = require("@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials");
const { Client } = require("@microsoft/microsoft-graph-client");
const core = require("@actions/core");

function getClient() {
  // Require AZ login and use those creds --> https://learn.microsoft.com/en-us/javascript/api/@azure/identity/defaultazurecredential?view=azure-node-latest
  const credential = new DefaultAzureCredential(); //or AzureCliCredential

  // https://learn.microsoft.com/en-us/graph/sdks/choose-authentication-providers?tabs=typescript#using-a-clients-secret
  // @microsoft/microsoft-graph-client/authProviders/azureTokenCredentials
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"],
  });

  return Client.initWithMiddleware({ authProvider: authProvider });
}

// Read all the inputs for this action
function getInputs() {
  return {
    groups: [
      core.getInput("admin_groups") || "",
      core.getInput("writer_groups") || "",
      core.getInput("reader_groups") || "",
    ],
    enterpriseAppObjectId: core.getInput("enterprise_app_object_id"), // GitHub enterprise app's object id. Entra ID > Enterprise applications > GitHub App > Overview > Object ID
    appRoleId: core.getInput("app_role_id"), // "User" role type for app registration. Entra ID > App registrations > GitHub App > (Manage) App Roles > 'User' role ID
  };
}

function parseGroups(inputGroups) {
  groupArray = [];
  for (const group of inputGroups.split(",")) {
    //capture the second element in group if it exists.
    if ((azureGroup = group.split(":")[1])) {
      groupArray.push(azureGroup.trim());
    }
  }
  return groupArray;
}

async function checkGroupsExist(client, groups) {
  for (const group of groups) {
    core.info(`Checking if group "${group}" exists in Entra ID.`);
    await client.api(`/groups/${group}`).get();
  }
}

// Get groups that currently have the desired app role assignment for the enterprise app
async function getAppGroupAssignments(client, servicePrincipalId, appRoleId) {
  return (
    await client
      .api(`/servicePrincipals/${servicePrincipalId}/appRoleAssignedTo`)
      .select("principalType,principalId,principalDisplayName,appRoleId")
      .get()
  ).value.filter((item) => item.appRoleId == appRoleId);
}

// Add a new group to the enterprise app
async function addGroupToApp(client, servicePrincipalId, appRoleId, groupId) {
  core.info(`\tAdding group ${groupId} to application.`);
  await client.api(`/servicePrincipals/${servicePrincipalId}/appRoleAssignedTo`).post({
    principalId: groupId, // group's principal id
    resourceId: servicePrincipalId, // service principal to add role assignment to
    appRoleId: appRoleId, // app role to assign to group
  });
  return true;
}

// check if group (by id) is in list of groups
function inGroup(groups, item) {
  return groups.some((element) => element.principalId == item) ? true : false;
}

async function addGroupsToApp(client, servicePrincipalId, appRoleId, groups, appGroups) {
  let added = false;
  // iterate through all groups we wish to add
  for (const group of groups) {
    // if the group is not already added to the app, then add it
    if (!inGroup(appGroups, group)) {
      await addGroupToApp(client, servicePrincipalId, appRoleId, group);
      added = true;
    }
  }
  return added;
}

async function getSyncJobId(client, servicePrincipalId) {
  return (await client.api(`/servicePrincipals/${servicePrincipalId}/synchronization/jobs/`).select("id").get())
    .value[0].id;
}

async function getSyncJobStatusCode(client, servicePrinicpalId, jobId) {
  return (
    await client.api(`/servicePrincipals/${servicePrinicpalId}/synchronization/jobs/${jobId}/`).select("status").get()
  ).status.code;
}

async function startSyncJob(client, servicePrincipalId, jobId) {
  return await client.api(`/servicePrincipals/${servicePrincipalId}/synchronization/jobs/${jobId}/start`).post();
}

async function runSync(client, servicePrincipal, syncJob) {
  const timeout = 60000;
  const sleep_interval = 5000; // how long to sleep each time
  let sleepTime = 0; // track how long we have slept already

  core.info("Starting sync job.");
  await startSyncJob(client, servicePrincipal, syncJob);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  core.info(`Waiting ${timeout / 1000} seconds(s) for sync.`);

  // Go through the loop at least once, but will evaluate 'code' at the end so it is accurate when we return it
  while (sleepTime < timeout) {
    core.info("...");
    sleepTime += sleep_interval;
    sleep(sleep_interval);
    if (sleepTime >= timeout) {
      break;
    }

    // Cant check the sync state --> "Active" is that the job is set up to run on a schedule.
    // NotConfigured, NotRun, Active, Paused, Quarantine.
  } //while ((code = await getSyncJobStatusCode(client, servicePrincipal, syncJob)) == "Active"); //store and evaluate code

  return await getSyncJobStatusCode(client, servicePrincipal, syncJob);
}

async function main() {
  const client = getClient();

  const inputs = getInputs();
  core.debug(`Inputs: ${JSON.stringify(inputs)}`);

  let addGroups = [];
  // Read all the input AD groups and add them to an array
  for (const item of inputs.groups) {
    addGroups = addGroups.concat(parseGroups(item));
  }

  // Filter array to remove duplicates
  addGroups = addGroups.filter((value, index, array) => {
    return array.indexOf(value) === index;
  });

  // TODO: check all groups in addGroups exist in EntraID
  core.info("Checking that each input group exists in Entra ID.");
  await checkGroupsExist(client, addGroups);

  core.info(`Input AD groups detected: "${addGroups}".`);

  core.info("Getting groups assigned to application.");
  const appGroups = await getAppGroupAssignments(client, inputs.enterpriseAppObjectId, inputs.appRoleId);
  core.debug(`AppGroups: ${JSON.stringify(appGroups)}`);

  //
  core.info("Checking if any input groups needs to be added to application.");
  if (await addGroupsToApp(client, inputs.enterpriseAppObjectId, inputs.appRoleId, addGroups, appGroups)) {
    core.info("Groups added, syncing app.");
    const syncJob = await getSyncJobId(client, inputs.enterpriseAppObjectId);

    core.debug(`Sync Job ID: "${syncJob}".`);

    const syncStatus = await runSync(client, inputs.enterpriseAppObjectId, syncJob);

    // Can't determine if the job completed unless it failed
    if (syncStatus == "Quarantine") {
      core.setFailed(`Sync job never completed. Currently in state "${syncStatus}", exiting.`);
      process.exit();
    }
    core.info("Sync complete!");
  } else {
    core.info("No changes to app made, not syncing.");
  }
}

main();
