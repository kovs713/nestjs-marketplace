import type { ZodType } from 'zod';

export function validateConfig<T extends object>(
  config: NodeJS.ProcessEnv,
  schema: ZodType<T>,
): T {
  const result = schema.safeParse(config);

  if (!result.success) {
    const messages = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      if (issue.code === 'invalid_type' && issue.input === undefined) {
        return `${path} is required`;
      }
      return path ? `${path}: ${issue.message}` : issue.message;
    });
    throw new Error(
      `Invalid environment variables:\n  - ${messages.join('\n  - ')}`,
    );
  }

  return result.data;
}
