import { assertAppInputs, assertPublicEnvironment } from '../core/inputs.mjs'
import {
  assert,
  readJson,
  repository,
  selectedCandidate,
  assetName,
  targets,
} from '../core/contracts.mjs'
import { repoApi, source, workflowArtifacts } from '../core/github.mjs'
import { fresh } from '../core/candidate.mjs'
import { summarize } from '../core/context.mjs'
import {
  actionsUrl,
  workflowUrl,
  runUrl,
  releasePr,
  panel,
  savePanel,
  phaseRuns,
  requestPhase,
} from './operator.mjs'

export function finalizationReady(candidate, release) {
  const platforms = ['macos-arm64', 'macos-x64', 'linux-x64']
  const packages = targets
    .filter(target => target.platform !== 'windows')
    .flatMap(target => {
      const name = assetName(candidate.version, target.suffix)
      return target.platform === 'macos' ? [name, name.replace(/\.dmg$/, '.app.tar.gz')] : [name]
    })
  return Boolean(
    candidate.windowsKitArtifact &&
    platforms.every(platform => candidate.preparation?.[platform]) &&
    packages.every(file =>
      candidate.artifacts.some(
        item =>
          item.file === file &&
          release.assets.some(
            asset => asset.name === file && asset.digest === `sha256:${item.sha256}`
          )
      )
    ) &&
    platforms.every(platform =>
      candidate.evidence.some(
        item =>
          item.file === `native-evidence-${platform}.json` &&
          release.assets.some(
            asset => asset.name === item.file && asset.digest === `sha256:${item.sha256}`
          )
      )
    ) &&
    release.assets.some(asset => asset.name === 'windows-submission.json')
  )
}

const isFailed = run =>
  run?.status === 'completed' && !['success', 'skipped'].includes(run.conclusion)
const label = run =>
  !run
    ? 'Waiting'
    : isFailed(run)
      ? `Failed (${run.conclusion})`
      : run.status === 'completed'
        ? 'Passed'
        : 'Running'
const link = (title, run, file) => `[${title}](${run ? runUrl(run.id) : workflowUrl(file)})`

export function updateRelease(pr, action = 'refresh') {
  assert(['refresh', 'retry', 'prepare-latest'].includes(action), 'Unknown release control action')
  const current = panel(pr)
  const controlsLink = `[Release controls](${workflowUrl('release-controls.yml')}) → Run workflow → main → PR **${pr.number}**`
  let state = 'Running',
    detail = '',
    rows = [],
    downloads = '',
    signing = ''
  try {
    const id = selectedCandidate(pr.body)
    const buildRuns = phaseRuns('release.yml', null, pr.head.ref)
    const build = buildRuns[0]
    rows.push(`| Checks and build | ${link(label(build), build, 'release.yml')} |`)
    if (action === 'prepare-latest') {
      const successful = buildRuns.find(
        run =>
          run.conclusion === 'success' &&
          workflowArtifacts(run.id).some(
            artifact => /^build-ready-\d+$/.test(artifact.name) && !artifact.expired
          )
      )
      assert(successful, 'No successful build is available; fix or retry the build first')
      current.state.requests.prepare = undefined
      requestPhase(
        pr,
        current,
        'prepare',
        'release-prepare.yml',
        `Prepare build ${successful.id}`,
        { build_run_id: String(successful.id), target: 'missing', pr_number: String(pr.number) },
        { retry: true }
      )
      detail = 'Preparing the selected successful build. Its application inputs must match this PR.'
    } else if (!id) {
      if (isFailed(build)) {
        state = 'Failed'
        detail =
          'Checks/build failed. Use **Re-run failed jobs** on the linked build. Source fixes require a new build.'
        if (action === 'retry') repoApi(`actions/runs/${build.id}/rerun-failed-jobs`, 'POST')
      } else detail = 'Checks, build and candidate preparation advance automatically.'
    } else if (pr.merged) {
      const publish = phaseRuns('release-publish.yml', `Publish release PR #${pr.number}`, null)[0]
      const published = repoApi('releases?per_page=100').find(
        release => release.tag_name === `v${pr.head.ref.slice(8)}` && !release.draft
      )
      if (published && publish?.conclusion === 'success') {
        state = 'Published'
        downloads = `[Download ClipsX ${pr.head.ref.slice(8)}](${published.html_url})`
        detail = 'The approved files are published. No rebuild or re-signing was performed.'
      } else {
        state = isFailed(publish) ? 'Failed' : 'Running'
        detail =
          'Publication promotes the approved files. Retry publication here without rebuilding or approving again.'
        if (action === 'retry')
          requestPhase(
            pr,
            current,
            'publish',
            'release-publish.yml',
            `Publish release PR #${pr.number}`,
            { pr_number: String(pr.number) },
            { retry: true }
          )
      }
      rows.push(`| Publish | ${link(label(publish), publish, 'release-publish.yml')} |`)
    } else {
      const { candidate, release } = fresh(id)
      assertAppInputs(candidate, source(pr.head.sha))
      assertPublicEnvironment(candidate)
      const prepare = phaseRuns(
        'release-prepare.yml',
        `Prepare build ${candidate.build.origin.runId}`
      )[0]
      const finalize = phaseRuns('release-finalize.yml', `Finalize candidate ${id}`)[0]
      const approve = phaseRuns(
        'release-certify.yml',
        `Approve candidate ${id} for PR #${pr.number}`
      )[0]
      rows[0] = `| Checks and build | [Passed — build ${candidate.build.origin.runId}](${runUrl(candidate.build.origin.runId)}) |`
      rows.push(
        `| Package | ${link(isFailed(prepare) && !candidate.finalizedAt ? label(prepare) : 'Saved packages', prepare, 'release-prepare.yml')} |`
      )
      rows.push(
        `| Verify final packages | ${link(candidate.finalizedAt ? 'Passed' : label(finalize), finalize, 'release-finalize.yml')} |`
      )
      rows.push(
        `| Approve, merge and publish | ${link(label(approve), approve, 'release-certify.yml')} |`
      )
      if (candidate.finalizedAt) {
        downloads = `[Download final installers and SHA256SUMS](${release.html_url}) · Candidate \`${id}\``
        state = isFailed(approve)
          ? 'Failed'
          : release.assets.some(asset => asset.name === 'certification.json')
            ? 'Running'
            : 'Waiting for approval'
        detail =
          'Test the final installers and updater, then open the approval run: **Review deployments → Approve and deploy**. This authorizes merging and publishing these exact files. No separate evidence form.'
        requestPhase(
          pr,
          current,
          'approve',
          'release-certify.yml',
          `Approve candidate ${id} for PR #${pr.number}`,
          { candidate_id: id, pr_number: String(pr.number) },
          { retry: action === 'retry' }
        )
        if (isFailed(approve))
          detail =
            'The approval/merge workflow failed. Inspect its failed job, resolve the reported problem, then retry. A completed approval is retained when retrying failed jobs.'
      } else if (finalizationReady(candidate, release)) {
        state = isFailed(finalize) ? 'Failed' : 'Running'
        detail =
          'All platform packages and Windows signing are ready. Final verification advances automatically.'
        requestPhase(
          pr,
          current,
          'finalize',
          'release-finalize.yml',
          `Finalize candidate ${id}`,
          { candidate_id: id },
          { retry: action === 'retry' }
        )
      } else {
        const missing = ['macos-arm64', 'macos-x64', 'linux-x64'].filter(
          platform => !candidate.preparation?.[platform]
        )
        if (isFailed(prepare)) {
          state = 'Failed'
          detail = `Packaging failed; successful outputs are preserved. Retry only the missing packages. ${missing.length ? `Missing: ${missing.join(', ')}.` : ''}`
        } else if (missing.length)
          detail = `Packaging: ${missing.join(', ')}. Successful outputs are preserved.`
        else if (!candidate.windowsKitArtifact)
          detail = 'Waiting for the Windows signing kit to be registered.'
        else state = 'Waiting for signing'
        if (
          candidate.windowsKitArtifact &&
          !release.assets.some(asset => asset.name === 'windows-submission.json')
        ) {
          const thumbprint = process.env.WINDOWS_SIGNING_CERT_THUMBPRINT
          assert(
            /^[A-Fa-f0-9]{40}$/.test(thumbprint || ''),
            'Configure WINDOWS_SIGNING_CERT_THUMBPRINT for the signing command'
          )
          signing = `\n### Sign Windows\n\nConnect SimplySign, open PowerShell 7 in the ClipsX repository, then run:\n\n\`\`\`powershell\n./scripts/release/sign-windows.ps1 -CandidateId ${id} -CertificateThumbprint ${thumbprint.toUpperCase()} -WorkingDirectory (Join-Path $env:TEMP ('clipsx-sign-' + [guid]::NewGuid().ToString('N')))\n\`\`\`\n\nThe command downloads the complete kit, signs, uploads and resumes the pipeline. If upload fails, keep its workspace and use the retry-submission command printed there.\n`
          if (state === 'Waiting for signing')
            detail =
              'Run the Windows signing command below once. Everything after upload resumes automatically.'
        }
        if (action === 'retry')
          requestPhase(
            pr,
            current,
            'prepare',
            'release-prepare.yml',
            `Prepare build ${candidate.build.origin.runId}`,
            {
              build_run_id: String(candidate.build.origin.runId),
              candidate_id: id,
              target: 'missing',
              pr_number: String(pr.number),
            },
            { retry: true }
          )
      }
      const uncertain = Object.values(current.state.requests).find(request => request?.error)
      if (uncertain) {
        state = 'Failed'
        detail = `A workflow request failed: ${uncertain.error}. Inspect Actions before using Retry; the existing candidate is preserved.`
      }
    }
  } catch (error) {
    state = 'Failed'
    detail = error.message
  }
  const markdown = `## ClipsX release — ${state}\n\n${detail}\n\n${downloads}\n\n| Stage | Status / logs |\n| --- | --- |\n${rows.join('\n')}\n${signing}\n### Recovery\n\n${controlsLink}. Choose **retry** for the failed stage or **refresh** to update this panel. **prepare-latest** explicitly selects a successful build after a source fix.\n\nActions also provides **Re-run failed jobs** on each run. Packaging/signing/publication retries reuse saved files. Source/build-input changes require a new build.\n\nNo LLM is needed to watch or advance this release. [All workflows](${actionsUrl}).`
  savePanel(pr, current, markdown)
  summarize(markdown)
  return state
}

export function controls(prNumber, action = 'refresh') {
  const event = process.env.GITHUB_EVENT_PATH ? readJson(process.env.GITHUB_EVENT_PATH) : {}
  if (
    !prNumber &&
    event.pull_request &&
    !/^release\/\d+\.\d+\.\d+$/.test(event.pull_request.head.ref)
  )
    return
  prNumber ||= event.pull_request?.number
  let publicationPr
  if (
    !prNumber &&
    (event.workflow_run?.path?.split('@')[0] === '.github/workflows/release-publish.yml' ||
      event.workflow_run?.name === 'Publish certified release')
  ) {
    const number = event.workflow_run.display_title?.match(/^Publish release PR #(\d+)$/)?.[1]
    if (number) {
      publicationPr = repoApi(`pulls/${number}`)
      if (
        publicationPr.base.ref !== 'main' ||
        publicationPr.head.repo.full_name !== repository ||
        !/^release\/\d+\.\d+\.\d+$/.test(publicationPr.head.ref)
      )
        return
    }
  }
  const pulls = publicationPr
    ? [publicationPr]
    : prNumber
      ? [releasePr(prNumber)]
      : repoApi('pulls?state=open&base=main&per_page=100').filter(
          pr =>
            pr.head.repo.full_name === repository && /^release\/\d+\.\d+\.\d+$/.test(pr.head.ref)
        )
  for (const pr of pulls) updateRelease(pr, action)
}
