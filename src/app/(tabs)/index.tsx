/**
 * Gyms: yours at the top, whatever is around you below, and a search box that
 * reaches anywhere.
 *
 * Three ways in, because they answer different questions. Nearby is for the
 * gym you are standing in. Search is for the gym you climb at while you are
 * somewhere else, which is the usual case when somebody is setting the app up.
 * My Gyms is what the app opens to once either of those has happened.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { Card, Row, Screen, SectionLabel, useColors } from '@/components/ui-kit';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { FoundGym, searchByName, searchNearby } from '@/lib/gym-search';
import { addAndFollow, listMyGyms, MyGym, unfollowGym } from '@/lib/gyms';

export default function GymsScreen() {
  const c = useColors();
  const { user } = useAuth();

  const [mine, setMine] = useState<MyGym[]>([]);
  const [loadingMine, setLoadingMine] = useState(true);

  const [nearby, setNearby] = useState<FoundGym[] | null>(null);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [nearbyNote, setNearbyNote] = useState('');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoundGym[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadMine = useCallback(async () => {
    try {
      setMine(await listMyGyms());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your gyms.');
    } finally {
      setLoadingMine(false);
    }
  }, []);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  // Nearby runs once on open rather than behind a button. It is the section
  // most likely to be useful and it costs nothing to have ready; a refused
  // location permission just leaves the section absent.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingNearby(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (!cancelled) setNearbyNote('Allow location to see gyms around you.');
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const at = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!cancelled) setHere(at);
        const found = await searchNearby(at.lat, at.lng);
        if (!cancelled) setNearby(found);
      } catch {
        if (!cancelled) setNearbyNote('Could not look around you just now.');
      } finally {
        if (!cancelled) setLoadingNearby(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Typing runs a search on a pause rather than on every keystroke, because
  // OpenStreetMap's search is a shared free service and one request per letter
  // is not a reasonable way to use it.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (query.trim().length < 3) {
      setResults(null);
      return;
    }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      setError('');
      try {
        // Biased towards wherever we last placed them, so the nearer of two
        // gyms with the same name comes first without excluding the far one.
        setResults(await searchByName(query, here ?? undefined));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed.');
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, here]);

  async function add(g: FoundGym) {
    if (!user) return;
    setBusyId(g.osmId);
    setError('');
    try {
      await addAndFollow({
        name: g.name,
        city: g.city,
        address: g.address,
        lat: g.lat,
        lng: g.lng,
        userId: user.id,
      });
      setQuery('');
      setResults(null);
      await loadMine();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that gym.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(gymId: string) {
    if (!user) return;
    setBusyId(gymId);
    try {
      await unfollowGym(gymId, user.id);
      await loadMine();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that gym.');
    } finally {
      setBusyId(null);
    }
  }

  const haveIt = (g: FoundGym) =>
    mine.some(
      (m) =>
        m.name.trim().toLowerCase() === g.name.trim().toLowerCase() &&
        (m.lat == null || Math.abs(m.lat - g.lat) < 0.003)
    );

  const searchMode = query.trim().length >= 3;

  return (
    <Screen title="Gyms" subtitle="Search anywhere, or pick one around you">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.two,
          backgroundColor: c.surface,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: Radius.md,
          paddingHorizontal: Spacing.three,
        }}>
        <Ionicons name="search" size={18} color={c.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Gym name, anywhere"
          placeholderTextColor={c.textFaint}
          autoCapitalize="words"
          autoCorrect={false}
          style={{ flex: 1, paddingVertical: 14, fontSize: 16, color: c.text }}
        />
        {searching ? <ActivityIndicator color={c.accent} /> : null}
        {query.length > 0 && !searching ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={c.textFaint} />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <View style={{ backgroundColor: c.fallSoft, borderRadius: Radius.md, padding: Spacing.three }}>
          <Text style={{ color: c.fall, fontSize: 14, lineHeight: 20 }}>{error}</Text>
        </View>
      ) : null}

      {searchMode ? (
        <View style={{ gap: Spacing.two }}>
          <SectionLabel>Results</SectionLabel>
          {results === null ? null : results.length === 0 ? (
            <Text style={{ color: c.textSecondary, fontSize: 14, paddingVertical: Spacing.two }}>
              Nothing found by that name. Try the gym's full name as it appears on the door.
            </Text>
          ) : (
            results.map((g) => (
              <FoundRow
                key={g.osmId}
                gym={g}
                added={haveIt(g)}
                busy={busyId === g.osmId}
                onAdd={() => add(g)}
              />
            ))
          )}
        </View>
      ) : (
        <>
          <View style={{ gap: Spacing.two }}>
            <SectionLabel>My gyms</SectionLabel>
            {loadingMine ? (
              <ActivityIndicator color={c.accent} style={{ paddingVertical: Spacing.four }} />
            ) : mine.length === 0 ? (
              <Card>
                <Text style={{ color: c.textSecondary, fontSize: 14, lineHeight: 20 }}>
                  Search for the gym you climb at, or pick one from below. It will sit here
                  afterwards.
                </Text>
              </Card>
            ) : (
              mine.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => router.push(`/gym/${g.id}`)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                  <Card>
                    <Row>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }}>
                          {g.name}
                        </Text>
                        <Text style={{ color: c.textSecondary, fontSize: 13 }}>
                          {[g.city, g.last_visit ? `last visit ${g.last_visit}` : 'no visits yet']
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                      {/* Removing is deliberately the smaller target of the two,
                          since opening a gym is what people came to do. */}
                      <Pressable onPress={() => remove(g.id)} hitSlop={10} disabled={busyId === g.id}>
                        {busyId === g.id ? (
                          <ActivityIndicator color={c.accent} />
                        ) : (
                          <Ionicons name="heart" size={20} color={c.accent} />
                        )}
                      </Pressable>
                      <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
                    </Row>
                  </Card>
                </Pressable>
              ))
            )}
          </View>

          <View style={{ gap: Spacing.two }}>
            <SectionLabel>Nearby</SectionLabel>
            {loadingNearby ? (
              <ActivityIndicator color={c.accent} style={{ paddingVertical: Spacing.four }} />
            ) : nearbyNote ? (
              <Card>
                <Text style={{ color: c.textSecondary, fontSize: 14 }}>{nearbyNote}</Text>
              </Card>
            ) : nearby && nearby.length > 0 ? (
              nearby
                .slice(0, 6)
                .map((g) => (
                  <FoundRow
                    key={g.osmId}
                    gym={g}
                    added={haveIt(g)}
                    busy={busyId === g.osmId}
                    onAdd={() => add(g)}
                  />
                ))
            ) : (
              <Card>
                <Text style={{ color: c.textSecondary, fontSize: 14 }}>
                  Nothing climbing related within 40 km. Search by name instead.
                </Text>
              </Card>
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

function FoundRow({
  gym,
  added,
  busy,
  onAdd,
}: {
  gym: FoundGym;
  added: boolean;
  busy: boolean;
  onAdd: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={added ? undefined : onAdd}
      disabled={added || busy}
      style={({ pressed }) => ({
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: Radius.md,
        padding: Spacing.three,
        opacity: pressed || busy ? 0.6 : 1,
      })}>
      <Row>
        <Ionicons
          name={gym.indoor ? 'business' : 'triangle-outline'}
          size={18}
          color={gym.indoor ? c.accent : c.textFaint}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{gym.name}</Text>
          <Text style={{ color: c.textSecondary, fontSize: 13 }}>
            {[
              gym.city,
              gym.distanceKm != null ? `${gym.distanceKm} km away` : null,
              gym.indoor ? null : 'outdoor',
            ]
              .filter(Boolean)
              .join(' · ') || 'Climbing'}
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator color={c.accent} />
        ) : added ? (
          <Ionicons name="checkmark-circle" size={22} color={c.sent} />
        ) : (
          <Ionicons name="add-circle-outline" size={22} color={c.textFaint} />
        )}
      </Row>
    </Pressable>
  );
}
