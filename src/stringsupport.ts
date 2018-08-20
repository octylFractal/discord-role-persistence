/**
 * Trim whitespace from each line of `str`.
 * @param str - the string to dedent
 */
export function dedent(str: string): string {
    const lines = str.split('\n');
    return lines.map(line => line.trim()).join('\n');
}