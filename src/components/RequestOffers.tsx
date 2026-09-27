import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { useRequests } from '../context/RequestsContext';
import { decideOffer, loadOfferPage, offerError, renewOffer, submitOffer, type OfferAction, type RequestOffer } from '../lib/offers';
import type { CampusRequest } from '../types';
import RatingSummary from './RatingSummary';
import RequestContact from './RequestContact';

type Props = { request?: CampusRequest; requestId?: string; ratingsRevision?: number; onChanged?: () => Promise<void> };
type OfferTerms = { round: number; points: number };
const labels = { pending: 'Pending', accepted: 'Accepted', rejected: 'Not selected', withdrawn: 'Withdrawn' };

export default function RequestOffers({ request, requestId, ratingsRevision = 0, onChanged }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const { invalidate } = useRequests();
  const userId = user?.id;
  const scope = `${userId}:${requestId ?? 'history'}`;
  const [loadedScope, setLoadedScope] = useState('');
  const [items, setItems] = useState<RequestOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [message, setMessage] = useState('');
  const [renewMessages, setRenewMessages] = useState<Record<string, string>>({});
  const [savingOperation, setSavingOperation] = useState<{ scope: string; epoch: number } | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const mutation = useRef<{ scope: string; epoch: number } | null>(null);
  const active = useRef(false);
  const focusEpoch = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const offset = useRef(0);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const fetchPage = useCallback(async (append = false): Promise<boolean> => {
    if (!userId || !active.current || currentScope.current !== scope || busy.current || mutation.current?.scope === scope) return false;
    const ticket = ++generation.current;
    busy.current = true; setLoading(true);
    try {
      const result = await loadOfferPage(userId, requestId ?? null, append ? offset.current : 0);
      if (ticket !== generation.current || currentScope.current !== scope || !active.current) return false;
      setLoadedScope(scope);
      setItems(previous => append ? [...previous, ...result.items.filter(row => !previous.some(old => old.id === row.id))] : result.items);
      offset.current = result.nextOffset; setHasMore(result.hasMore); setError('');
      return true;
    } catch (failure) {
      if (ticket === generation.current && currentScope.current === scope && active.current) setError(offerError(failure));
      return false;
    } finally {
      if (ticket === generation.current) { busy.current = false; setLoading(false); }
    }
  }, [userId, requestId, scope]);

  useFocusEffect(useCallback(() => {
    active.current = true;
    ++focusEpoch.current;
    setMessage(''); setRenewMessages({}); setNotice(''); setItems([]); setLoadedScope(''); setHasMore(false);
    void fetchPage();
    const timer = setInterval(() => { void fetchPage(); }, 60000);
    return () => { active.current = false; ++focusEpoch.current; ++generation.current; busy.current = false; clearInterval(timer); };
  }, [fetchPage]));

  const visible = loadedScope === scope ? items : [];
  const saving = savingOperation?.scope === scope;
  const owner = !!request && request.ownerId === userId;
  const ready = loadedScope === scope && !loading && !saving && !error;
  const canOffer = !!request && request.status === 'open' && Date.parse(request.deadlineAt ?? '') > Date.now();

  const perform = async (action: OfferAction | 'renew' | 'create', terms: OfferTerms, epoch: number, offer?: RequestOffer, offerMessage = '') => {
    if (!userId || mutation.current?.scope === scope || busy.current || !active.current || currentScope.current !== scope || focusEpoch.current !== epoch) return;
    const operation = { scope, epoch };
    mutation.current = operation; setSavingOperation(operation); setNotice(''); setError('');
    let committed = false;
    try {
      if (action === 'renew' && offer) await renewOffer(userId, offer.id, terms.round, offerMessage, terms.points);
      else if (action !== 'renew' && action !== 'create' && offer) await decideOffer(userId, offer.id, action, terms.round, terms.points);
      else if (action === 'create' && requestId) await submitOffer(userId, requestId, offerMessage, terms.round, terms.points);
      else return;
      committed = true;
      invalidate();
      if (active.current && currentScope.current === scope && focusEpoch.current === epoch) {
        setMessage('');
        if (offer) setRenewMessages(previous => ({ ...previous, [offer.id]: '' }));
        setNotice(action === 'renew' ? 'Your new offer was saved. Its current status is shown below.' : action === 'create' ? 'Your offer was saved. Its current status is shown below.' : 'Your decision was saved.');
      }
    } catch (failure) {
      if (active.current && currentScope.current === scope && focusEpoch.current === epoch) setError(offerError(failure));
    } finally {
      if (mutation.current === operation) mutation.current = null;
      // My offers stays mounted behind request details. Finishing while blurred must release its saving state.
      setSavingOperation(value => value === operation ? null : value);
      if (active.current && currentScope.current === scope) {
        // Refocusing during the mutation skips the initial read. Reconcile even if that response failed.
        if (committed || focusEpoch.current !== epoch) {
          const refreshEpoch = focusEpoch.current;
          const refreshed = await fetchPage();
          if ((committed || refreshed) && active.current && currentScope.current === scope && focusEpoch.current === refreshEpoch) await changed.current?.();
        }
      }
    }
  };

  const confirm = (action: OfferAction, offer: RequestOffer) => {
    const epoch = focusEpoch.current;
    const terms = { round: offer.offer_round, points: offer.request_points };
    const text = action === 'accepted'
      ? `Accept this helper and reserve ${terms.points} points from your available balance? Points transfer only after you confirm completion. Other pending offers will be declined. Reopening releases the reservation and requires fresh offers.`
      : action === 'rejected' ? 'Decline this offer? This helper can offer again after you change the reward or reopen the request.'
      : 'Withdraw your offer? You can offer again after the poster changes the reward or reopens the request.';
    Alert.alert(action === 'accepted' ? 'Accept helper?' : action === 'rejected' ? 'Decline offer?' : 'Withdraw offer?', text, [
      { text: 'Keep as is', style: 'cancel' },
      { text: action === 'accepted' ? 'Accept' : action === 'rejected' ? 'Decline' : 'Withdraw', style: action === 'accepted' ? 'default' : 'destructive', onPress: () => { void perform(action, terms, epoch, offer); } },
    ]);
  };

  const confirmOffer = (offer?: RequestOffer) => {
    const epoch = focusEpoch.current;
    const terms = offer
      ? { round: offer.request_offer_round, points: offer.request_points }
      : request ? { round: request.offerRound ?? 1, points: request.points } : null;
    if (!terms) return;
    const offerMessage = offer ? renewMessages[offer.id] ?? '' : message;
    Alert.alert(offer ? 'Confirm offer again?' : 'Offer help?', `Offer to help for ${terms.points} points? Points transfer after the poster confirms completion.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm offer', onPress: () => { void perform(offer ? 'renew' : 'create', terms, epoch, offer, offerMessage); } },
    ]);
  };

  return <View style={styles.section}>
    <Text style={styles.heading}>{requestId ? owner ? 'Offers to help' : 'Your offer' : 'My offers'}</Text>
    <Pressable accessibilityRole="button" style={styles.secondary} disabled={loading || saving} onPress={() => { void fetchPage().then(ok => { if (ok) void changed.current?.(); }); }}>
      <Text style={styles.secondaryText}>{loading ? 'Refreshing offers…' : 'Refresh offers'}</Text>
    </Pressable>
    {loading && <ActivityIndicator color="#9B1C31" />}
    {!!notice && <Text accessibilityRole="alert" style={styles.text}>{notice}</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {saving && <Text accessibilityRole="alert" style={styles.text}>Saving…</Text>}
    {!owner && request?.ownerId && <View style={styles.card}>
      <RequestContact requestId={request.id} profileId={request.ownerId} role="poster" revision={`${request.offerRound}:${request.status}`} />
      {visible.length > 0 && <RatingSummary key={`poster-rating:${request.ownerId}:${ratingsRevision}`} profileId={request.ownerId} requestId={request.id} />}
    </View>}
    {!loading && !error && !visible.length && <Text style={styles.text}>{owner ? 'No offers yet.' : requestId ? 'You have not offered help for this request.' : 'Your offers will appear here, including accepted and closed requests.'}</Text>}
    {requestId && request && !owner && visible.length === 0 && <View style={styles.card}>
      {canOffer ? <>
        <Text style={styles.label}>Current reward: {request.points} points</Text>
        <Text style={styles.text}>Offer to help with this request. The owner will see your name, major, year, campus and published reliability rating, even if your profile is hidden from discovery.</Text>
        <Text style={styles.label}>Message (optional)</Text>
        <TextInput accessibilityLabel="Optional offer message" style={styles.input} multiline maxLength={1000} value={message} editable={!saving} onChangeText={setMessage} placeholder="Let the owner know how you can help" textAlignVertical="top" />
        <Text style={styles.text}>{message.length}/1000</Text>
        <Pressable accessibilityRole="button" disabled={!ready} style={[styles.primary, !ready && styles.disabled]} onPress={() => confirmOffer()}><Text style={styles.primaryText}>Offer Help</Text></Pressable>
      </> : <Text style={styles.text}>This request is no longer accepting offers.</Text>}
    </View>}
    {visible.map(offer => {
      const open = offer.request_status === 'open' && Date.parse(offer.request_deadline_at) > Date.now();
      const currentRound = offer.offer_round === offer.request_offer_round;
      const actionable = ready && open && currentRound && offer.status === 'pending';
      const canRenew = open && !currentRound && offer.offering_user_id === userId && ['rejected', 'withdrawn'].includes(offer.status);
      return <View key={offer.id} style={styles.card}>
        <Text style={styles.title}>{requestId ? owner ? offer.helper_display_name || 'Campus helper' : 'Your offer' : offer.request_title}</Text>
        <Text style={styles.status}>{open && !currentRound ? 'Confirmation needed' : labels[offer.status]}</Text>
        <Text style={styles.label}>Current reward: {offer.request_points} points</Text>
        {!currentRound && <Text style={styles.text}>The poster changed the reward or reopened this request. This earlier offer is closed; the helper must confirm the current reward to be considered again.</Text>}
        {!open && <Text style={styles.text}>Request {offer.request_status === 'open' ? 'expired' : offer.request_status}.</Text>}
        {owner && <Text style={styles.text}>{[offer.helper_major, offer.helper_year ? `Year ${offer.helper_year}` : null, offer.helper_campus].filter(Boolean).join(' • ')}</Text>}
        {owner && <RatingSummary key={`helper-rating:${offer.offering_user_id}:${ratingsRevision}`} profileId={offer.offering_user_id} requestId={offer.request_id} />}
        {owner && <RequestContact requestId={offer.request_id} profileId={offer.offering_user_id} role="helper" compact revision={`${offer.request_offer_round}:${offer.request_status}`} />}
        {!!offer.message && <Text style={styles.text}>{offer.message}</Text>}
        <Text style={styles.text}>First offered {new Date(offer.created_at).toLocaleString()}</Text>
        {owner && offer.status === 'pending' && open && currentRound && <>
          <Pressable accessibilityRole="button" disabled={!actionable} style={[styles.primary, !actionable && styles.disabled]} onPress={() => confirm('accepted', offer)}><Text style={styles.primaryText}>Accept helper</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={!actionable} style={[styles.secondary, !actionable && styles.disabled]} onPress={() => confirm('rejected', offer)}><Text style={styles.secondaryText}>Decline offer</Text></Pressable>
        </>}
        {offer.offering_user_id === userId && offer.status === 'pending' && open && currentRound && <Pressable accessibilityRole="button" disabled={!actionable} style={[styles.secondary, !actionable && styles.disabled]} onPress={() => confirm('withdrawn', offer)}><Text style={styles.secondaryText}>Withdraw offer</Text></Pressable>}
        {canRenew && <>
          <Text style={styles.label}>New message (optional)</Text>
          <TextInput accessibilityLabel={`New offer message for ${offer.request_title}`} style={styles.input} multiline maxLength={1000} value={renewMessages[offer.id] ?? ''} editable={!saving} onChangeText={value => setRenewMessages(previous => ({ ...previous, [offer.id]: value }))} placeholder="Confirm you are available to help" textAlignVertical="top" />
          <Pressable accessibilityRole="button" disabled={!ready} style={[styles.primary, !ready && styles.disabled]} onPress={() => confirmOffer(offer)}><Text style={styles.primaryText}>Offer again</Text></Pressable>
        </>}
        {!requestId && (open || offer.status === 'accepted' || offer.has_assignment_history) && <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.push({ pathname: '/requests/[id]', params: { id: offer.request_id } })}><Text style={styles.secondaryText}>View request</Text></Pressable>}
        {offer.has_assignment_history && <Text style={styles.text}>Open request details to view your completed or cancelled assignments and rate the other participant after an assignment ends.</Text>}
        {offer.status === 'accepted' && <Text style={styles.text}>{offer.request_status === 'completed' ? 'Request completed. Open its details to rate the other participant.' : 'Help confirmed. Find this request in My offers as the helper, or My requests as the poster.'}</Text>}
      </View>;
    })}
    {hasMore && <Pressable accessibilityRole="button" disabled={loading || saving} style={styles.secondary} onPress={() => { void fetchPage(true); }}><Text style={styles.secondaryText}>Load more offers</Text></Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 14, marginTop: 20 }, heading: { fontSize: 22, fontWeight: '800', color: '#2B2525' },
  card: { padding: 16, borderWidth: 1, borderColor: '#ECE3E3', borderRadius: 18, gap: 12 },
  title: { fontSize: 18, fontWeight: '800', color: '#2B2525' }, status: { color: '#9B1C31', fontWeight: '800', fontSize: 16 },
  text: { fontSize: 15, lineHeight: 22, color: '#635C5C' }, label: { fontSize: 15, color: '#2B2525', fontWeight: '700' },
  error: { color: '#9B1C31', lineHeight: 22 }, input: { minHeight: 100, padding: 12, borderWidth: 1, borderColor: '#BDB3B3', borderRadius: 12, color: '#2B2525', fontSize: 16 },
  primary: { minHeight: 48, padding: 14, borderRadius: 16, backgroundColor: '#9B1C31', alignItems: 'center' }, primaryText: { color: 'white', fontWeight: '800', fontSize: 16 },
  secondary: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#9B1C31', borderRadius: 14, alignItems: 'center' }, secondaryText: { color: '#9B1C31', fontWeight: '700', fontSize: 15 }, disabled: { opacity: .45 },
});
