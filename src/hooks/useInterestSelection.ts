import { useCallback, useEffect, useRef, useState } from 'react';
import { getInterests, getProfileInterests } from '@/lib/profiles';
import { mergeInterestChoices } from '@/lib/interestChoices';
import type { Interest } from '@/types';

export function useInterestSelection(profileId: string | undefined) {
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selectedInterestIds, setSelectedInterestIds] = useState<string[]>([]);
  const [isLoadingInterests, setIsLoadingInterests] = useState(true);
  const [interestError, setInterestError] = useState<string | null>(null);
  const generation = useRef(0);

  const loadInterests = useCallback(async () => {
    const ticket = ++generation.current;
    setIsLoadingInterests(true);
    setInterestError(null);
    if (!profileId) {
      setInterests([]); setSelectedInterestIds([]);
      setInterestError('Profile unavailable.'); setIsLoadingInterests(false);
      return;
    }
    try {
      const [available, saved] = await Promise.all([getInterests(), getProfileInterests(profileId)]);
      if (ticket !== generation.current) return;
      setInterests(mergeInterestChoices(available, saved));
      setSelectedInterestIds(saved.map(item => item.id));
    } catch {
      if (ticket === generation.current) setInterestError('Unable to load interests. Check your connection and retry.');
    } finally {
      if (ticket === generation.current) setIsLoadingInterests(false);
    }
  }, [profileId]);

  useEffect(() => {
    const counter = generation;
    setInterests([]); setSelectedInterestIds([]);
    void loadInterests();
    return () => { ++counter.current; };
  }, [loadInterests]);

  return { interests, selectedInterestIds, setSelectedInterestIds, isLoadingInterests, interestError, loadInterests };
}
