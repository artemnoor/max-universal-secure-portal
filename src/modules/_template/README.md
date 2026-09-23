# Module template

Copy this directory to a kebab-case module ID, add one `ModuleDefinition`, and register it in the composition root. Keep state under the module namespace, declare every capability and dependency, and add security tests before enabling the module.

For staging/production, include an explicit review in the manifest before registration:

```ts
securityReview: {
  owner: 'team@example.com',
  reviewedAt: '2026-09-23T00:00:00.000Z',
  threatModel: 'docs/security/threat-model.md#module-boundary',
  dataClasses: ['public'],
},
```

This is an admission gate, not a replacement for resource ownership checks, callback authorization, or module-specific security tests.
