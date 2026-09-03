export type FieldMutation<T> = {
  path: string;
  mutate: (value: T) => T;
  remove?: (value: T) => T;
};

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function assertSecurityMutationsFail<T>(params: {
  valid: T;
  fields: FieldMutation<T>[];
  validate: (value: T) => { ok: boolean; message?: string };
  allow?: string[];
}): Array<{ path: string; kind: 'mutate' | 'remove'; ok: boolean; message?: string }> {
  const allowed = new Set(params.allow ?? []);
  const results: Array<{ path: string; kind: 'mutate' | 'remove'; ok: boolean; message?: string }> =
    [];
  for (const field of params.fields) {
    const mutated = field.mutate(cloneJson(params.valid));
    const mutatedResult = params.validate(mutated);
    results.push({
      path: field.path,
      kind: 'mutate',
      ok: mutatedResult.ok,
      message: mutatedResult.message,
    });
    if (!allowed.has(field.path) && mutatedResult.ok) {
      throw new Error(`security field ${field.path} accepted a mutation`);
    }
    if (field.remove) {
      const removed = field.remove(cloneJson(params.valid));
      const removedResult = params.validate(removed);
      results.push({
        path: field.path,
        kind: 'remove',
        ok: removedResult.ok,
        message: removedResult.message,
      });
      if (!allowed.has(field.path) && removedResult.ok) {
        throw new Error(`security field ${field.path} accepted removal`);
      }
    }
  }
  return results;
}
