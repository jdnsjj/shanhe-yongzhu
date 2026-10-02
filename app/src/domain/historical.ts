/** Historical sources are context, never predetermined effects. */
export function historicalContext(raw: unknown, year: number): Record<string, unknown>[] {
  if (!Array.isArray(raw)) throw new Error('历史事件资料格式无效')
  return raw.filter((item) => item && typeof item === 'object' && Number(item.min_year ?? 1627) <= year)
    .map((item) => ({
      id: item.id, title: item.title, background: item.text,
      earliest_year: item.min_year, condition: item.condition,
      once: item.once,
      possible_responses: Array.isArray(item.choices) ? item.choices.map((choice: { label?: string }) => choice.label) : [],
    }))
}
