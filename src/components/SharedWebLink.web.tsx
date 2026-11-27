import { type Href, useRootNavigationState, useRouter } from 'expo-router';
import { useEffect } from 'react';

// Capture the incoming URL before protected routes redirect a new visitor.
// Only replay student-facing links. Email callbacks and tokens stay out of storage.
const storageKey = 'clu:shared-link';
const detail = /^\/(?:students|messages|requests)\/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const lists = /^\/(?:requests|courses|messages|notifications|courses\/(?:add|classmates|reviews|review-directory))$/;

function shareable(url: URL) {
  const path = url.pathname.replace(/\/$/, '');
  if (detail.test(path)) return path;
  if (!lists.test(path)) return null;
  const field = path === '/courses/classmates' ? 'courseId' : path === '/courses/reviews' ? 'code' : null;
  const value = field && url.searchParams.get(field);
  return field && value ? path + '?' + new URLSearchParams({ [field]: value }) : path;
}

function initialDestination() {
  if (typeof window === 'undefined') return null;
  const current = new URL(window.location.href);
  const path = shareable(current);
  try {
    if (path) window.sessionStorage.setItem(storageKey, path);
    else if (/^\/(?:sign-in|sign-up|profile\/onboarding)\/?$/.test(current.pathname)) {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved) return shareable(new URL(saved, current.origin));
    } else window.sessionStorage.removeItem(storageKey);
  } catch { /* The open document still remembers the destination. */ }
  return path;
}

let destination = initialDestination();

function takeDestination() {
  const path = destination;
  destination = null;
  if (path) {
    try { window.sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
  }
  return path;
}

export default function SharedWebLink() {
  const router = useRouter();
  const state = useRootNavigationState();
  useEffect(() => {
    if (!state?.key) return;
    const path = takeDestination();
    if (path && window.location.pathname + window.location.search !== path) router.replace(path as Href);
  }, [state?.key, router]);
  return null;
}
