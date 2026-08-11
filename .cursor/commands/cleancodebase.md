# /cleancodebase

Authorize a focused cleanup pass only. Do not push.

1. Limit changes to dead code, unused imports, obvious duplication, and local clarity inside the requested scope.
2. Do not alter product behavior, schema, RLS, release metadata, or workflow safety gates.
3. Run the narrowest relevant checks for the touched files.
4. Commit locally only when the user asked for the cleanup to be committed.
