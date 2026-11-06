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
import { addAndFollow, addGym, listMyGyms, MyGym, unfollowGym } from '@/lib/gyms';

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
  const [error, setError] = useState('');

  // Which row is waiting on the network to open. Opening is the one action
  // here that genuinely makes somebody wait, because it has to put the gym in
  // the directory before it can navigate to it.
  const [openingId, setOpeningId] = useState<string | null>(null);

  /**
   * Hearts that have been tapped but not yet confirmed by the server, keyed by
   * the row's OpenStreetMap id. True means following, false means not.
   *
   * This exists so the heart can flip under the finger instead of after a
   * round trip. Claiming a gym is cheap and trivially undone, so making
   * somebody watch a spinner for it reads as the app being slow rather than
   * careful. If the write fails the entry is dropped and the heart snaps back
   * to whatever the server actually thinks.
   */
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const settle = (osmId: string) =>
    setPending((p) => {
      const { [osmId]: _gone, ...rest } = p;
      return rest;
    });

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

  /**
   * Open a gym without claiming it.
   *
   * Visiting somewhere once and climbing there every week are different
   * things, and tapping a row should mean the first. The gym still has to
   * enter the shared directory to have routes hung off it, so it is created
   * if nobody has added it yet, but it does not join your list. addGym
   * returns the existing row when there is one, so this does not duplicate.
   */
  async function open(g: FoundGym) {
    if (!user) return;
    const already = mineMatch(g);
    if (already) {
      router.push(`/gym/${already.id}`);
      return;
    }

    setOpeningId(g.osmId);
    setError('');
    try {
      const gym = await addGym({
        name: g.name,
        city: g.city,
        address: g.address,
        lat: g.lat,
        lng: g.lng,
        addedBy: user.id,
      });
      router.push(`/gym/${gym.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that gym.');
    } finally {
      setOpeningId(null);
    }
  }

  /** Claim a gym as one of yours. Only the plus does this. */
  async function follow(g: FoundGym) {
    if (!user) return;
    setPending((p) => ({ ...p, [g.osmId]: true }));
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
      await loadMine();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that gym.');
    } finally {
      settle(g.osmId);
    }
  }

  /**
   * Drop a gym off your list from a search or nearby row.
   *
   * Separate from remove() only because the busy spinner is keyed by whatever
   * id the row knows itself by, and these rows know their OpenStreetMap id
   * rather than the database one.
   */
  async function unfollowFound(g: FoundGym) {
    const match = mineMatch(g);
    if (!user || !match) return;
    setPending((p) => ({ ...p, [g.osmId]: false }));
    setError('');
    try {
      await unfollowGym(match.id, user.id);
      await loadMine();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that gym.');
    } finally {
      settle(g.osmId);
    }
  }

  /**
   * Drop a gym from the My Gyms list. The row leaves immediately and comes
   * back if the server refuses, which is the same bargain as the hearts
   * below: instant, and corrected rather than delayed.
   */
  async function remove(gymId: string) {
    if (!user) return;
    const before = mine;
    setMine((list) => list.filter((m) => m.id !== gymId));
    setError('');
    try {
      await unfollowGym(gymId, user.id);
      await loadMine();
    } catch (e) {
      setMine(before);
      setError(e instanceof Error ? e.message : 'Could not remove that gym.');
    }
  }

  /**
   * The gym on your list that this search result refers to, if any.
   *
   * Returns the row rather than a boolean because opening one needs its
   * database id, and a result off OpenStreetMap does not carry one. Matched
   * the same way addGym decides two entries are the same place.
   */
  const mineMatch = (g: FoundGym) =>
    mine.find(
      (m) =>
        m.name.trim().toLowerCase() === g.name.trim().toLowerCase() &&
        (m.lat == null || Math.abs(m.lat - g.lat) < 0.003)
    );

  const isMine = (g: FoundGym) =>
    g.osmId in pending ? pending[g.osmId] : !!mineMatch(g);

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
                added={isMine(g)}
                opening={openingId === g.osmId}
                onOpen={() => open(g)}
                onFollow={() => follow(g)}
                onUnfollow={() => unfollowFound(g)}
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
                  Tap a gym below to look around it. Tap the plus beside one to keep it here,
                  for the gym you actually climb at.
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
                      <Pressable onPress={() => remove(g.id)} hitSlop={12}>
                        <Ionicons name="heart" size={20} color={c.accent} />
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
                    added={isMine(g)}
                    opening={openingId === g.osmId}
                    onOpen={() => open(g)}
                    onFollow={() => follow(g)}
                    onUnfollow={() => unfollowFound(g)}
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

/**
 * A gym from search or from looking around.
 *
 * Two separate targets on purpose. The row opens the gym, which is what
 * somebody passing through wants and costs them nothing. The plus is the only
 * thing that puts it on their list, because being somewhere once and climbing
 * there every week are different claims and the app should not make the
 * second one on their behalf.
 */
function FoundRow({
  gym,
  added,
  opening,
  onOpen,
  onFollow,
  onUnfollow,
}: {
  gym: FoundGym;
  added: boolean;
  opening: boolean;
  onOpen: () => void;
  onFollow: () => void;
  onUnfollow: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onOpen}
      disabled={opening}
      style={({ pressed }) => ({
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: Radius.md,
        padding: Spacing.three,
        opacity: pressed || opening ? 0.6 : 1,
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
        {/* Both states get their own hit area. Without one the icon is just a
            picture and the tap lands on the row behind it, which is why the
            heart used to open the gym instead of letting go of it.
            No spinner here: the icon has already changed by the time the
            request goes out. */}
        <Pressable onPress={added ? onUnfollow : onFollow} hitSlop={12}>
          <Ionicons
            name={added ? 'heart' : 'add-circle-outline'}
            size={added ? 22 : 24}
            color={added ? c.accent : c.textFaint}
          />
        </Pressable>

        {/* Waiting belongs here, next to the arrow that says this row leads
            somewhere, rather than on the heart that had nothing to do with it. */}
        {opening ? (
          <ActivityIndicator size="small" color={c.accent} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
        )}
      </Row>
    </Pressable>
  );
}
