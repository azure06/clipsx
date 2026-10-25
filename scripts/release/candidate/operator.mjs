import { assert, repository, selectedCandidate } from '../core/contracts.mjs'
import { repoApi } from '../core/github.mjs'

export const approvalEnvironment = 'desktop-release'
export const dashboardMarker = '<!-- clipsx-release-dashboard -->'
export const actionsUrl = `https://github.com/${repository}/actions`
export const workflowUrl = file => `${actionsUrl}/workflows/${file}`
export const runUrl = id => `${actionsUrl}/runs/${id}`

export function releasePr(number) {
  assert(/^\d+$/.test(String(number)), 'Select a release PR number')
  const pr = repoApi(`pulls/${number}`)
  assert(
    pr.base.ref === 'main' &&
      pr.head.repo.full_name === repository &&
      /^release\/\d+\.\d+\.\d+$/.test(pr.head.ref),
    'Wrong release PR'
  )
  return pr
}

export function panel(pr) {
  let page = 1
  let comment
  for (;;) {
    const comments = repoApi(`issues/${pr.number}/comments?per_page=100&page=${page++}`)
    comment = comments.find(
      item => item.user?.login === 'github-actions[bot]' && item.body?.startsWith(dashboardMarker)
    )
    if (comment || comments.length < 100) break
  }
  const encoded = comment?.body.match(/<!-- clipsx-release-state: ([A-Za-z0-9+/=]+) -->/)?.[1]
  let state = {}
  try {
    if (encoded) state = JSON.parse(Buffer.from(encoded, 'base64').toString())
  } catch {
    /* Display state is advisory, never authorization. */
  }
  if (state.candidateId !== selectedCandidate(pr.body))
    state = { candidateId: selectedCandidate(pr.body), requests: {} }
  state.requests ||= {}
  return { comment, state }
}

export function savePanel(pr, current, markdown, overview) {
  current.markdown =
    markdown ||
    current.markdown ||
    current.comment?.body
      .split('\n<!-- clipsx-release-state:')[0]
      .replace(`${dashboardMarker}\n`, '') ||
    'Updating release status…'
  const state = Buffer.from(JSON.stringify(current.state)).toString('base64')
  const body = `${dashboardMarker}\n${current.markdown}\n<!-- clipsx-release-state: ${state} -->`
  if (body !== current.comment?.body)
    current.comment = current.comment
      ? repoApi(`issues/comments/${current.comment.id}`, 'PATCH', { body })
      : repoApi(`issues/${pr.number}/comments`, 'POST', { body })
  if (overview !== undefined) {
    const start = '<!-- clipsx-release-overview:start -->',
      end = '<!-- clipsx-release-overview:end -->'
    const link = current.comment.html_url || `${pr.html_url}#issuecomment-${current.comment.id}`
    const block = `${start}\n${overview}\n\n[All stages, logs and retry controls](${link})\n${end}`
    const latest = repoApi(`pulls/${pr.number}`)
    assert(
      selectedCandidate(latest.body) === selectedCandidate(pr.body),
      'Release selection changed while updating its overview'
    )
    const previous = latest.body || ''
    const next = previous.includes(start)
      ? previous.replace(
          /<!-- clipsx-release-overview:start -->[\s\S]*?<!-- clipsx-release-overview:end -->/,
          block
        )
      : `${block}\n\n${previous}`
    if (next !== previous) {
      repoApi(`pulls/${pr.number}`, 'PATCH', { body: next })
      pr.body = next
    }
  }
}

export function phaseRuns(file, title, branch = 'main') {
  return repoApi(
    `actions/workflows/${file}/runs?${branch ? `branch=${encodeURIComponent(branch)}&` : ''}per_page=100`
  )
    .workflow_runs.filter(
      run =>
        run.path?.split('@')[0] === `.github/workflows/${file}` &&
        run.head_repository?.full_name === repository &&
        (!title || run.display_title === title)
    )
    .sort((a, b) => b.id - a.id)
}

// Persist the request BEFORE dispatch. Event redelivery/API visibility delays cannot
// start a second run. A failed/uncertain request stays visible until an explicit retry.
export function requestPhase(pr, current, phase, file, title, inputs, { retry = false } = {}) {
  const runs = phaseRuns(file, title, phase === 'publish' ? null : 'main')
  const latest = runs[0]
  if (current.state.requests[phase]?.title !== title) delete current.state.requests[phase]
  if (latest && current.state.requests[phase]) delete current.state.requests[phase].error
  if (latest && latest.status !== 'completed') return latest
  if (latest?.conclusion === 'success' && phase !== 'prepare') return latest
  if (!retry && (current.state.requests[phase] || latest)) return latest
  current.state.requests[phase] = { requestedAt: new Date().toISOString(), file, title }
  savePanel(pr, current)
  try {
    if (retry && latest && phase !== 'prepare') {
      repoApi(
        `actions/runs/${latest.id}/${latest.conclusion === 'cancelled' ? 'rerun' : 'rerun-failed-jobs'}`,
        'POST'
      )
    } else repoApi(`actions/workflows/${file}/dispatches`, 'POST', { ref: 'main', inputs })
  } catch (error) {
    current.state.requests[phase].error = error.message
    savePanel(pr, current)
    throw error
  }
  return latest
}

export function assertApprovalEnvironment() {
  const environment = repoApi(`environments/${approvalEnvironment}`)
  assert(
    environment.protection_rules?.some(
      rule => rule.type === 'required_reviewers' && rule.reviewers?.length
    ),
    `Configure a required reviewer on the ${approvalEnvironment} environment before releasing`
  )
  assert(
    environment.can_admins_bypass === false,
    'Disable administrator bypass on the release approval environment'
  )
  assert(
    environment.deployment_branch_policy?.custom_branch_policies === true,
    'Restrict the release approval environment to main'
  )
  const branches = repoApi(
    `environments/${approvalEnvironment}/deployment-branch-policies?per_page=100`
  ).branch_policies
  assert(
    branches.length === 1 && branches[0].name === 'main' && branches[0].type === 'branch',
    'The release approval environment must allow only the main branch'
  )
  return environment
}
