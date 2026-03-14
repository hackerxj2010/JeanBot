export class EntityGraph {
  private readonly links = new Map<string, Set<string>>();

  link(left: string, right: string) {
    const existing = this.links.get(left) ?? new Set<string>();
    existing.add(right);
    this.links.set(left, existing);
  }

  neighbors(entity: string) {
    return [...(this.links.get(entity) ?? new Set<string>())];
  }
}
