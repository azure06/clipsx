import { githubFixture } from './github-fixture.mjs'
import { services } from '../core/github.mjs'
import { encode, repository } from '../core/contracts.mjs'

export function operatorFixture() {
  const f = githubFixture()
  const previousEnvironment = { ...process.env }
  process.env.GITHUB_RUN_ID = '999'
  process.env.GITHUB_RUN_ATTEMPT = '1'
  process.env.WINDOWS_SIGNING_CERT_THUMBPRINT = 'A'.repeat(40)
  const pr = {
    number: 45,
    state: 'open',
    draft: true,
    html_url: 'https://github.com/azure06/clipsx/pull/45',
    base: { ref: 'main', sha: f.candidate.sourceRevision },
    head: {
      ref: f.candidate.branch,
      sha: f.candidate.sourceRevision,
      repo: { full_name: repository },
    },
    body: `<!-- clipsx-release-candidate: ${f.candidate.id} -->`,
  }
  const environment = {
    id: 10,
    can_admins_bypass: false,
    protection_rules: [
      {
        type: 'required_reviewers',
        reviewers: [{ type: 'User', reviewer: { login: 'maintainer' } }],
      },
    ],
    deployment_branch_policy: { custom_branch_policies: true },
  }
  const state = {
    comments: [],
    runs: {},
    artifacts: [],
    statuses: [],
    reviews: [
      {
        state: 'approved',
        environments: [{ id: 10, name: 'desktop-release' }],
        user: { login: 'maintainer', type: 'User' },
      },
    ],
    environment,
  }
  const api = services.api,
    command = services.command
  services.api = (path, method = 'GET', body) => {
    if (/\/commits\/[^/]+\/statuses\?/.test(path)) return structuredClone(state.statuses)
    if (path.includes('/actions/runs/100/attempts/1') || /\/releases\/1$|\/commits\//.test(path))
      return api(path, method, body)
    f.trace.push({ path, method, body })
    if (path.endsWith('/pulls/45/merge')) {
      pr.merged = true
      pr.state = 'closed'
      return { merged: true }
    }
    if (path.endsWith('/pulls/45')) {
      if (method === 'PATCH') Object.assign(pr, body)
      return structuredClone(pr)
    }
    if (path.includes('/pulls?')) return [structuredClone(pr)]
    if (path.includes('/issues/45/comments')) {
      if (method === 'POST') {
        const comment = {
          id: state.comments.length + 1,
          user: { login: 'github-actions[bot]' },
          ...body,
        }
        state.comments.push(comment)
        return structuredClone(comment)
      }
      return structuredClone(state.comments)
    }
    if (path.includes('/issues/comments/')) {
      const comment = state.comments.find(item => item.id === Number(path.split('/').at(-1)))
      Object.assign(comment, body)
      return structuredClone(comment)
    }
    if (path.includes('/actions/workflows/')) {
      if (method === 'POST') return null
      const file = path.split('/workflows/')[1].split('/')[0]
      return { workflow_runs: structuredClone(state.runs[file] || []) }
    }
    if (path.endsWith('/actions/runs/999/approvals')) return state.reviews
    if (path.endsWith('/actions/runs/999'))
      return {
        path: '.github/workflows/release-certify.yml',
        display_title: `Verify candidate ${f.candidate.id} for PR #45 at ${pr.head.sha}`,
        status: 'completed',
        conclusion: 'success',
        event: 'workflow_dispatch',
        head_branch: 'main',
        head_sha: f.candidate.sourceRevision,
        head_repository: { full_name: repository },
      }
    if (path.includes('/rerun')) return null
    if (path.includes('/deployment-branch-policies'))
      return { branch_policies: [{ name: 'main', type: 'branch' }] }
    if (path.endsWith('/environments/desktop-release')) return environment
    if (/\/commits\/[^/]+\/statuses\?/.test(path)) return structuredClone(state.statuses)
    if (path.includes('/statuses/')) {
      const status = {
        ...body,
        created_at: new Date().toISOString(),
        creator: { login: 'github-actions[bot]' },
      }
      state.statuses.unshift(status)
      return status
    }
    if (path.includes('/releases?')) return [structuredClone(f.release)]
    throw new Error(`Unexpected API ${method} ${path}`)
  }
  services.command = (program, args, options) => {
    if (program === 'gh' && args[1]?.includes('/actions/runs/999/artifacts'))
      return JSON.stringify([{ artifacts: state.artifacts }])
    if (program === 'gh' && args[0] === 'pr' && args[1] === 'ready') {
      pr.draft = false
      return ''
    }
    return command(program, args, options)
  }
  const restore = f.restore
  return {
    ...f,
    pr,
    state,
    save() {
      f.put('candidate.json', f.candidate)
    },
    addRun(file, title, status = 'completed', conclusion = 'success') {
      const run = {
        id: 1234,
        path: `.github/workflows/${file}`,
        display_title: title,
        status,
        conclusion,
        head_repository: { full_name: repository },
      }
      state.runs[file] = [run]
      return run
    },
    restore() {
      restore()
      for (const key of Object.keys(process.env))
        if (!(key in previousEnvironment)) delete process.env[key]
      Object.assign(process.env, previousEnvironment)
    },
    candidateBytes() {
      return Buffer.from(encode(f.candidate))
    },
  }
}
