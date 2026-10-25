import { assert } from '../core/contracts.mjs'
import { api, repoApi } from '../core/github.mjs'
import { approvalEnvironment, assertApprovalEnvironment } from '../candidate/operator.mjs'

// One-time maintainer setup. This configures a gate; it never dispatches a release.
export function configureApproval(login) {
  assert(/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(login), 'Specify the GitHub maintainer login')
  const user = api(`users/${login}`)
  assert(user.type === 'User', 'Choose a human release reviewer')
  repoApi(`environments/${approvalEnvironment}`, 'PUT', {
    wait_timer: 0,
    prevent_self_review: false,
    can_admins_bypass: false,
    reviewers: [{ type: 'User', id: user.id }],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  })
  const branches = repoApi(
    `environments/${approvalEnvironment}/deployment-branch-policies?per_page=100`
  ).branch_policies
  assert(
    branches.every(branch => branch.name === 'main' && branch.type === 'branch'),
    'Remove other branch/tag policies from desktop-release in GitHub Settings, then rerun setup'
  )
  if (!branches.length)
    repoApi(`environments/${approvalEnvironment}/deployment-branch-policies`, 'POST', {
      name: 'main',
      type: 'branch',
    })
  // Some API versions ignore can_admins_bypass on PUT. The GET check must still
  // pass: disable "Allow administrators to bypass" in Settings if it does not.
  assertApprovalEnvironment()
  console.log(
    `Configured ${approvalEnvironment}: ${login} approves; only main can deploy. No release was started.`
  )
}
