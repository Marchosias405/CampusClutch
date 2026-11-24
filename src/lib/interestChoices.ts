import catalog from '@/constants/interest-catalog.json';
import type { Interest } from '@/types';

export const interestCategories = catalog.map(({ id, label }) => ({ id, label }));
const categoryBySlug = new Map(catalog.flatMap(group => group.interests.map(item => [item.slug, group.id] as const)));

export function groupInterestChoices(interests: Interest[], query: string, category: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return [...interestCategories, { id: 'other', label: 'More interests' }].map(group => ({
    ...group,
    interests: interests.filter(interest => {
      if (!interest.isActive || (category !== 'all' && category !== group.id)) return false;
      if ((categoryBySlug.get(interest.slug) ?? 'other') !== group.id) return false;
      const searchable = `${interest.displayName} ${interest.slug.replace(/-/g, ' ')} ${group.label}`.toLocaleLowerCase();
      return terms.every(term => searchable.includes(term));
    }).sort((a, b) => a.displayName.localeCompare(b.displayName)),
  })).filter(group => group.interests.length > 0);
}

// Keep saved selections visible even if an option is retired from the catalog.
export function mergeInterestChoices(available: Interest[], saved: Interest[]) {
  return [...new Map([...saved, ...available].map(interest => [interest.id, interest])).values()];
}
