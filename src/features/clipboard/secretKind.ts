const SECRET_KIND_KEYS = {
  aws_access_key: 'preview.secretKinds.awsAccessKey',
  github_token: 'preview.secretKinds.githubToken',
  stripe_key: 'preview.secretKinds.stripeKey',
  private_key: 'preview.secretKinds.privateKey',
  credential_assignment: 'preview.secretKinds.credentialAssignment',
  api_key: 'preview.secretKinds.apiKey',
  url_credential: 'preview.secretKinds.urlCredential',
  authorization_header: 'preview.secretKinds.authorizationHeader',
} as const

export function secretKindKey(kind: string) {
  return Object.hasOwn(SECRET_KIND_KEYS, kind)
    ? SECRET_KIND_KEYS[kind as keyof typeof SECRET_KIND_KEYS]
    : 'preview.secretKinds.unknown'
}
