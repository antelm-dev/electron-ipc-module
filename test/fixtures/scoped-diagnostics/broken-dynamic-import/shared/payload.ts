// Deliberately broken, and reached only through a dynamic `import(...)` call.
export function helper(): string {
  return "x";
}
export const brokenHelper: string = 42;
