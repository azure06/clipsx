# ClipsX Cloud Security Contract

## Privacy boundary

Clipboard capture and local history never invoke cloud upload code. A cloud item
is created only when the user explicitly selects **Add to Vault**. The resulting
vault item is an independent snapshot: deleting either the local clip or the
vault item does not delete the other.

Native Office clipboard binaries are local-only. An Office vault snapshot may
contain deliberately selected encrypted text and safe preview representations,
but it must never include `attachment_path`, `attachment_type`, native OLE
bytes, or native clipboard-format payloads.

## Key hierarchy

```text
device public keys / account recovery key
                    |
          collection key version
                    |
             wrapped item key
                    |
          encrypted item payload
```

- Every authorized device owns a unique public/private encryption key pair.
- Device private keys are stored in the operating-system credential vault.
- Every collection has a current random collection key and monotonically
  increasing key version.
- Every item has a random item key. The item key encrypts content and is wrapped
  by the current collection key.
- A collection key is encrypted separately for each active device and for each
  authorized account recovery key.
- The recovery code is a high-entropy secret held by the user. The server stores
  only the encrypted recovery-key backup.

A personal vault is a collection whose only member is its owner.

## Membership changes

Adding a member creates collection-key envelopes for that member's authorized
devices. By default, the member receives the historical key versions needed to
read existing collection history.

Removing a member revokes server authorization and immediately creates a new
collection-key version that is distributed only to remaining devices. Future
items use the new key. Existing per-item keys may be rewrapped under the new
collection key without re-encrypting large payloads.

No system can revoke plaintext, ciphertext, or keys already downloaded by a
previously authorized member. Product copy must state this limitation clearly.

## Server-visible data

The service may see identifiers, collection membership, roles, key versions,
ciphertext sizes, object references, synchronization versions, timestamps,
quota state, and operational errors. It must not receive plaintext clip
contents, notes, tags, titles, filenames, attachment bytes, or private keys.

Supabase tables in exposed schemas and private Storage objects require
membership- or ownership-based RLS. Authentication alone is never sufficient
authorization.

## Synchronization

Clients use an idempotent offline outbox and a server cursor. Deletes propagate
as tombstones. Updates use optimistic versions. When two encrypted edits race,
the client preserves the losing edit as a conflict copy rather than silently
discarding it.

Search and indexing happen locally after decryption.

## Anonymous links

An anonymous share contains two independent secrets:

- An opaque access token used by the website to fetch ciphertext.
- A decryption secret carried only in the URL fragment, which is not sent in
  HTTP requests.

Share expiry is selected by the sender. Links can be revoked before expiry.
Recipients can retain data they already decrypted.

## Hosted AI

Hosted AI is an explicit exception to vault E2EE. For one requested action, the
client decrypts only the selected content and sends it to a trusted endpoint
that verifies entitlement and allowance. The UI must disclose this plaintext
processing. Prompts and outputs must not be retained or logged.

AI output becomes a new local clip. It enters a vault only through a later
explicit Add to Vault action.
