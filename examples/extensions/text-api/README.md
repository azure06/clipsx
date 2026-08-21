# Text API

An intentionally small custom-UI example for the checksum-bound HTTPS bridge.
It can contact only `POST https://httpbin.org/anything`, cannot access secrets,
and can return the response only through declared host output dispositions.

```powershell
npm run extension:pack -- examples/extensions/text-api examples/extensions/packages/text-api-1.0.0.clipsx
npm run extension:validate -- examples/extensions/packages/text-api-1.0.0.clipsx
```
