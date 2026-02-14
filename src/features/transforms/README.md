# Transforms Feature

## Responsibilities
- AI text transformations (grammar, tone, summary)
- Transform preview with diff
- Transform history/cache
- Batch transformations

## Components
- `TransformMenu.tsx` - Quick action menu
- `TransformPreview.tsx` - Before/after diff view
- `TransformSettings.tsx` - API key configuration

## Hooks
- `useTransform.ts` - Execute transformations
- `useTransformPreview.ts` - Preview state management

## Types
- `TransformOperation` - Available transform types
- `TransformResult` - Result with tokens used
