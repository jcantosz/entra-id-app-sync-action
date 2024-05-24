# Entra ID App Sync Action

Action that adds groups to an enterprise app in Entra ID. If any groups were added to the application then the app's sync job is run. If groups already exist on the application, they are skipped. Intended for use with [team synchronization](https://docs.github.com/en/enterprise-cloud@latest/admin/identity-and-access-management/using-saml-for-enterprise-iam/managing-team-synchronization-for-organizations-in-your-enterprise) between your IDP and GitHub

## Example workflow

Workflow to add/sync groups with information submitted in an issue

```yaml add_groups.yaml
name: Add groups to Entra ID app and sync app
on:
  issue:
    types:
      - opened
jobs:
  AddGroups:
    runs-on: ubuntu-latest
    jobs:
      - name: Checkout
        uses: actions/checkout@v4

      # Extract info from issue template
      - uses: stefanbuck/github-issue-parser@v3
        id: issue-parser
        with:
          template-path: .github/ISSUE_TEMPLATE/add_entra_group.yaml

      # https://github.com/marketplace/actions/azure-login
      - name: Azure login
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      - name: Sync Groups
        uses: jcantosz/entra-id-app-sync-action@main
        with:
          # The enterprise app that is used for GitHub sync (Entra ID > Enterprise applications > GitHub App > Overview > Object ID)
          enterprise_app_object_id: ${{ secrets.AZURE_ENTERPRISE_APP_OBJECT_ID}}
          # The app role of the enterprise app to add new groups as. (Entra ID > App registrations > GitHub App > (Manage) App Roles > 'User' role ID)
          app_role_id: ${{ secrets.AZURE_ENTERPRISE_APP_ROLE}}
          # Input groups. Expected form is a string formatted like this: "<GitHub_Team_1_Name>:<Entra_Group_1_ID>,<GGitHub_Team_2_Name>:<Entra_Group_2_ID>..."
          admin_groups: ${{steps.issue-parser.outputs.issueparser_admin-groups}}
          # Input groups. Functionality is identical to "admin_groups", either or both can be set
          writer_groups: ${{steps.issue-parser.outputs.issueparser_writer-groups}}
          # Input groups. Functionality is identical to "admin_groups", either or both can be set
          reader_groups: ${{steps.issue-parser.outputs.issueparser_reader-groups}}
```

## Parameters

| Parameter                | Description                                                                                                                                       | Default | Required | Notes                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| enterprise_app_object_id | The enterprise app that is used for GitHub sync.                                                                                                  | `none`  | `true`   | Find this value in: Entra ID > Enterprise applications > GitHub App > Overview > Object ID                                                                      |
| app_role_id              | The app role of the enterprise app to add new groups as.                                                                                          | `none`  | `true`   | Find this value in: Entra ID > App registrations > GitHub App > (Manage) App Roles > 'User' role ID                                                             |
| admin_groups             | Input groups. Expected form is a string formatted like this: `<GitHub_Team_1_Name>:<Entra_Group_1_ID>,<GitHub_Team_2_Name>:<Entra_Group_2_ID>...` | `none`  | `false`  | Exists for compatibility with larger workflow that provisions multiple GitHub groups with varying permission levels. Could be combined into single group input. |
| writer_groups            | Input groups. Functionality is identical to `admin_groups`, either or both can be set                                                             | `none`  | `false`  | Exists for compatibility with larger workflow that provisions multiple GitHub groups with varying permission levels. Could be combined into single group input. |
| reader_groups            | Input groups. Functionality is identical to `admin_groups`, either or both can be set                                                             | `none`  | `false`  | Exists for compatibility with larger workflow that provisions multiple GitHub groups with varying permission levels. Could be combined into single group input. |

## Sample issue template

```yaml add_entra_group.yaml
name: Add Entra Groups
description: Add groups to GitHub app in Entra and sync app if there were changes
title: "[ENTRA GROUPS]: "
labels: ["groups"]
body:
  - type: input
    id: repo-name
    attributes:
      label: Repository Name
      description: "The repository to grant team permissions on"
      placeholder: "my-org/my-repo"
  - type: input
    id: admin-groups
    attributes:
      label: Admin groups
      description: "Groups to add as **admin teams** in GitHub. Of the form: `<GitHub_Team_1_Name>:<Entra_Group_1_ID>,<GGitHub_Team_2_Name>:<Entra_Group_2_ID>`"
      placeholder: "team1:<UUID>, team2:<UUID>"
  - type: input
    id: writer-groups
    attributes:
      label: Writer groups
      description: "Groups to add as **writer teams** in GitHub. Of the form: `<GitHub_Team_1_Name>:<Entra_Group_1_ID>,<GGitHub_Team_2_Name>:<Entra_Group_2_ID>`"
      placeholder: "team1:<UUID>, team2:<UUID>"
  - type: input
    id: reader-groups
    attributes:
      label: Reader groups
      description: "Groups to add as **reader teams** in GitHub. Of the form: `<GitHub_Team_1_Name>:<Entra_Group_1_ID>,<GGitHub_Team_2_Name>:<Entra_Group_2_ID>`"
      placeholder: "team1:<UUID>, team2:<UUID>"
```
