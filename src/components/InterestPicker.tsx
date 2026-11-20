import { MotionPressable as Pressable } from '@/components/motion';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { groupInterestChoices } from '@/lib/interestChoices';
import type { Interest } from '@/types';

type Props = { interests: Interest[]; selectedIds: string[]; onToggle: (id: string) => void; disabled?: boolean };

export default function InterestPicker({ interests, selectedIds, onToggle, disabled = false }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showAllSelected, setShowAllSelected] = useState(false);
  const categories = groupInterestChoices(interests, '', 'all');
  const groups = groupInterestChoices(interests, query, category);
  const selected = selectedIds.flatMap(id => interests.find(item => item.id === id) ?? []);
  const hasQuery = query.trim().length > 0;

  const chip = (interest: Interest, removable = false) => {
    const isSelected = selectedIds.includes(interest.id);
    return <Pressable key={interest.id} accessibilityRole={removable ? 'button' : 'checkbox'}
      accessibilityLabel={`${removable ? 'Remove ' : ''}${interest.displayName}`}
      accessibilityState={removable ? { disabled } : { checked: isSelected, disabled }}
      aria-checked={removable ? undefined : isSelected}
      disabled={disabled} onPress={() => onToggle(interest.id)}
      style={[styles.chip, isSelected && styles.selectedChip, disabled && styles.disabled]}>
      <Ionicons name={removable ? 'close' : isSelected ? 'checkmark' : 'add'} size={16} color={isSelected ? '#9B1C31' : '#746B6E'} />
      <Text style={[styles.chipText, isSelected && styles.selectedText]}>{interest.displayName}{!interest.isActive ? ' (retired)' : ''}</Text>
    </Pressable>;
  };

  return <View style={styles.container}>
    <View style={styles.selectedBox}>
      <View style={styles.headingRow}><Text style={styles.heading}>Your interests</Text><Text style={styles.hint}>{selected.length} selected</Text></View>
      <Text style={styles.hint}>A few favorites can help you find things in common. All choices are optional.</Text>
      {selected.length > 0 ? <>
        <View style={styles.chips}>{(showAllSelected ? selected : selected.slice(0, 6)).map(item => chip(item, true))}</View>
        {selected.length > 6 && <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAllSelected }} aria-expanded={showAllSelected}
          onPress={() => setShowAllSelected(value => !value)} style={styles.textButton}>
          <Text style={styles.action}>{showAllSelected ? 'Show fewer selected' : `Show all ${selected.length} selected`}</Text>
        </Pressable>}
      </> : <Text style={styles.emptySelection}>Choose what feels like you below.</Text>}
    </View>

    <View style={styles.search}>
      <Ionicons name="search-outline" size={20} color="#746B6E" />
      <TextInput accessibilityLabel="Search interests" placeholder="Search interests"
        placeholderTextColor="#746B6E" value={query} onChangeText={value => { setQuery(value); setCategory('all'); }}
        autoCorrect={false} autoCapitalize="none" editable={!disabled} style={styles.searchInput} />
      {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear interest search" disabled={disabled}
        onPress={() => setQuery('')} style={styles.clear}><Ionicons name="close-circle" size={21} color="#746B6E" /></Pressable>}
    </View>

    <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled" contentContainerStyle={styles.categories}>
      {[{ id: 'all', label: 'All interests' }, ...categories].map(group => <Pressable key={group.id}
        accessibilityRole="tab" accessibilityState={{ selected: category === group.id, disabled }} aria-selected={category === group.id} disabled={disabled}
        onPress={() => { setCategory(group.id); setQuery(''); }}
        style={[styles.category, category === group.id && styles.activeCategory]}>
        <Text style={[styles.categoryText, category === group.id && styles.activeCategoryText]}>{group.label}</Text>
      </Pressable>)}
    </ScrollView>

    {groups.length === 0 && <Text accessibilityLiveRegion="polite" style={styles.hint}>No interests found. Try another search or category.</Text>}
    {groups.map(group => {
      const isExpanded = hasQuery || category !== 'all' || expanded.includes(group.id);
      return <View key={group.id} style={styles.group}>
        <Text accessibilityRole="header" style={styles.heading}>{group.label}</Text>
        <View style={styles.chips}>{(isExpanded ? group.interests : group.interests.slice(0, 4)).map(item => chip(item))}</View>
        {!hasQuery && category === 'all' && group.interests.length > 4 && <Pressable accessibilityRole="button"
          accessibilityLabel={`${isExpanded ? 'Show fewer' : 'Show more'} ${group.label} interests`}
          accessibilityState={{ expanded: isExpanded }} aria-expanded={isExpanded} style={styles.textButton}
          onPress={() => setExpanded(current => current.includes(group.id) ? current.filter(id => id !== group.id) : [...current, group.id])}>
          <Text style={styles.action}>{isExpanded ? 'Show fewer' : `Show ${group.interests.length - 4} more`}</Text>
        </Pressable>}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  container: { gap: 16, marginTop: 12 },
  selectedBox: { backgroundColor: '#FBF4F5', borderColor: '#E8DDDF', borderWidth: 1, borderRadius: 20, padding: 16, gap: 10 },
  heading: { fontSize: 16, fontWeight: '800', color: '#2B2525' },
  hint: { fontSize: 14, lineHeight: 21, color: '#746B6E' },
  emptySelection: { fontSize: 14, color: '#9B1C31' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, borderRadius: 16, backgroundColor: '#FBF8F8', borderColor: '#E8DDDF', borderWidth: 1 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 50, paddingVertical: 12, fontSize: 15, color: '#2B2525' },
  clear: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center' },
  categories: { gap: 8, paddingBottom: 8 },
  category: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'center', borderRadius: 24, borderWidth: 1, borderColor: '#E8DDDF' },
  activeCategory: { backgroundColor: '#9B1C31', borderColor: '#9B1C31' },
  categoryText: { color: '#746B6E', fontWeight: '700', fontSize: 14 },
  activeCategoryText: { color: '#FFFFFF' },
  group: { gap: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#EFE1E1' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', minHeight: 48, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 24, borderWidth: 1, borderColor: '#E8DDDF', backgroundColor: '#FFFFFF' },
  selectedChip: { borderColor: '#9B1C31', backgroundColor: '#F7E7EA' },
  chipText: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: '#50484A' },
  selectedText: { color: '#9B1C31' },
  disabled: { opacity: 0.55 },
  textButton: { alignSelf: 'flex-start', minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
  action: { color: '#9B1C31', fontSize: 14, fontWeight: '700' },
});
