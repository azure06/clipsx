import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { DecisionReviewNotice } from './DecisionReviewNotice'
import type { DecisionReview } from '../../shared/types/v2'

afterEach(cleanup)
const failure = (
  stage: DecisionReview['stage'],
  reason: DecisionReview['reason']
): DecisionReview => ({ stage, reason, status: 'not_checked', evaluatedAt: 1 })

it('shows no warning for historical or completed checks', () => {
  const view = render(<DecisionReviewNotice />)
  expect(view.container).toBeEmptyDOMElement()
  view.rerender(
    <DecisionReviewNotice
      reviews={[{ stage: 'privacy', reason: null, status: 'completed', evaluatedAt: 1 }]}
    />
  )
  expect(view.container).toBeEmptyDOMElement()
})

it('keeps privacy details collapsed until requested while leaving the clip visible', async () => {
  render(
    <>
      <DecisionReviewNotice
        reviews={[
          failure('privacy', 'input_limit'),
          failure('organization', 'privacy_not_checked'),
        ]}
      />
      <pre>Full original content</pre>
    </>
  )
  const details = screen.getByText(/text exceeded/)
  expect(details).not.toBeVisible()
  await userEvent.click(screen.getByText('Privacy not checked.'))
  expect(details).toBeVisible()
  expect(details).toHaveTextContent(/does not block Recall/)
  expect(screen.getByText('Full original content')).toBeVisible()
  expect(screen.queryByText(/Organization rules not applied/)).not.toBeInTheDocument()
})

it('distinguishes an organization failure from a privacy failure', () => {
  render(<DecisionReviewNotice compact reviews={[failure('organization', 'timeout')]} />)
  expect(screen.getByText('Not checked').parentElement).toHaveAccessibleName(
    /Organization rules not applied.*timed out/
  )
  expect(screen.queryByText(/Privacy not checked/)).not.toBeInTheDocument()
})
