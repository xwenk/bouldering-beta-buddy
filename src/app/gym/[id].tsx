/**
 * One gym: what is on its walls right now.
 *
 * Routes are grouped by wall because that is how somebody standing in a gym
 * thinks about them. Nobody looks for "all the V4s"; they look at the wall in
 * front of them and want to know what is on it.
 *
 * Before any of that can work the gym has to have been set up once: how it
 * grades, and what its walls are called. Neither is in any public dataset, so
 * the first person here answers it and everybody after them picks from chips.
 * Until then the screen asks for that instead of offering an add button that
 * would have no grades to show.
 *
 * The list is only live routes. Stripped ones stay in the database so old
 * sessions still read correctly.
 */
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Chip, Row, Screen, SectionLabel, useColors } from '@/components/ui-kit';
import { GRADING_SYSTEMS, GradingSystemId, HOLD_COLORS, holdHex } from '@/constants/climbing';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import {
  addWall,
  Gym,
  GymGrade,
  GymWall,
  isSetUp,
  listGrades,
  listGyms,
  listWalls,
  setUpGym,
} from '@/lib/gyms';
import { addRoute, listRoutes, matchesQuery, RouteWithStats } from '@/lib/routes';
import { listSentRouteIds } from '@/lib/sends';

/**
 * What the list is showing.
 *
 * "On the wall" is the default because that is the question somebody standing
 * in a gym is asking. The other two exist because a problem that came off the
 * wall is not gone: it is still in somebody's session and still worth looking
 * up by name.
 */
const FILTERS = [
  { id: 'wall', label: 'On the wall' },
  { id: 'all', label: 'Everything' },
  { id: 'mine', label: 'Sent by me' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

export default function GymScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const c = useColors();
  const { user } = useAuth();

  const [gym, setGym] = useState<Gym | null>(null);
  const [grades, setGrades] = useState<GymGrade[]>([]);
  const [walls, setWalls] = useState<GymWall[]>([]);
  const [routes, setRoutes] = useState<RouteWithStats[]>([]);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterId>('wall');

  const load = useCallback(async () => {
    if (!id) return;
    setError('');
    try {
      const [gyms, gs, ws, rs, sent] = await Promise.all([
        listGyms(),
        listGrades(id),
        listWalls(id),
        listRoutes(id),
        listSentRouteIds(id),
      ]);
      setGym(gyms.find((g) => g.id === id) ?? null);
      setGrades(gs);
      setWalls(ws);
      setRoutes(rs);
      setSentIds(sent);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this gym.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: gym?.name ?? '' });
  }, [navigation, gym]);

  const ready = isSetUp(gym);
  const live = routes.filter((r) => !r.stripped_on);

  // What the filter and the search box leave. Searching looks through
  // everything the gym has ever had, including problems that came off the
  // wall, because looking one up by name is usually looking for an old one.
  const shown = (
    filter === 'wall' ? live : filter === 'mine' ? routes.filter((r) => sentIds.has(r.id)) : routes
  ).filter((r) => matchesQuery(r, query));

  const searching = query.trim().length > 0;

  // Grouped in the gym's own wall order, with anything untagged last, since
  // "somewhere in the gym" is the least useful heading to lead with. A search
  // is one flat list instead, because the answer is usually one row and
  // headings get in the way of it.
  const byWall = shown.reduce<Record<string, RouteWithStats[]>>((acc, r) => {
    (acc[r.wall_name ?? ''] ??= []).push(r);
    return acc;
  }, {});
  const wallOrder = [...walls.map((w) => w.name).filter((n) => byWall[n]), ...(byWall[''] ? [''] : [])];

  return (
    <Screen
      title={gym?.name ?? 'Gym'}
      subtitle={
        loading || !gym
          ? ''
          : !ready
            ? 'Not set up yet'
            : live.length
              ? `${live.length} problem${live.length === 1 ? '' : 's'} on the wall`
              : 'Nothing logged on these walls yet'
      }>
      {error ? (
        <View style={{ backgroundColor: c.fallSoft, borderRadius: Radius.md, padding: Spacing.three }}>
          <Text style={{ color: c.fall, fontSize: 14 }}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={c.accent} style={{ paddingVertical: Spacing.five }} />
      ) : !ready ? (
        <Card style={{ alignItems: 'center', paddingVertical: Spacing.five, gap: Spacing.two }}>
          <Ionicons name="options-outline" size={30} color={c.textFaint} />
          <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>Set this gym up first</Text>
          <Text
            style={{
              color: c.textSecondary,
              fontSize: 14,
              textAlign: 'center',
              lineHeight: 20,
              paddingHorizontal: Spacing.three,
            }}>
            How does this gym grade, and what are its walls called? Answer once and everyone who
            logs a problem here picks from a list instead of typing.
          </Text>
          <View style={{ marginTop: Spacing.two, alignSelf: 'stretch' }}>
            <Button label="Set up this gym" icon="options-outline" onPress={() => setConfiguring(true)} />
          </View>
        </Card>
      ) : (
        <>
          <Button label="Add a problem" icon="add" onPress={() => setAdding(true)} />

          <SearchBox value={query} onChange={setQuery} />

          <View style={{ flexDirection: 'row', gap: Spacing.two }}>
            {FILTERS.map((f) => (
              <Chip
                key={f.id}
                label={f.label}
                selected={filter === f.id}
                onPress={() => setFilter(f.id)}
              />
            ))}
          </View>

          {routes.length === 0 ? (
            <Card style={{ alignItems: 'center', paddingVertical: Spacing.five, gap: Spacing.two }}>
              <Ionicons name="layers-outline" size={30} color={c.textFaint} />
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>No problems yet</Text>
              <Text
                style={{
                  color: c.textSecondary,
                  fontSize: 14,
                  textAlign: 'center',
                  lineHeight: 20,
                  paddingHorizontal: Spacing.three,
                }}>
                Add the ones you climb. The grade, the hold colour and which wall is enough for
                anyone else to find it.
              </Text>
            </Card>
          ) : shown.length === 0 ? (
            <Card>
              <Text style={{ color: c.textSecondary, fontSize: 14 }}>
                {searching
                  ? `Nothing here matches “${query.trim()}”.`
                  : filter === 'mine'
                    ? 'You have not sent anything here yet.'
                    : 'Nothing on the wall right now.'}
              </Text>
            </Card>
          ) : searching ? (
            <View style={{ gap: Spacing.two }}>
              <SectionLabel>{`${shown.length} match${shown.length === 1 ? '' : 'es'}`}</SectionLabel>
              {shown.map((r) => (
                <RouteRow key={r.id} route={r} />
              ))}
            </View>
          ) : (
            wallOrder.map((wall) => (
              <View key={wall || 'untagged'} style={{ gap: Spacing.two }}>
                <SectionLabel>{wall || 'Wall not set'}</SectionLabel>
                {byWall[wall].map((r) => (
                  <RouteRow key={r.id} route={r} />
                ))}
              </View>
            ))
          )}

          <Pressable onPress={() => setConfiguring(true)} style={{ paddingVertical: Spacing.two }}>
            <Text style={{ color: c.textFaint, fontSize: 13, textAlign: 'center' }}>
              Walls or grading wrong? Fix them
            </Text>
          </Pressable>
        </>
      )}

      <SetUpSheet
        open={configuring}
        gym={gym}
        walls={walls}
        userId={user?.id}
        onClose={() => setConfiguring(false)}
        onSaved={() => {
          setConfiguring(false);
          load();
        }}
      />

      <AddRouteSheet
        open={adding}
        gymId={id!}
        grades={grades}
        walls={walls}
        userId={user?.id}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          load();
        }}
      />
    </Screen>
  );
}

/** Filters as you type. No debounce, because nothing here goes to the network. */
function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const c = useColors();
  return (
    <Row
      style={{
        backgroundColor: c.surfaceSunken,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: Radius.md,
        paddingHorizontal: Spacing.three,
      }}>
      <Ionicons name="search" size={18} color={c.textFaint} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Name, setter, grade, wall, colour"
        placeholderTextColor={c.textFaint}
        autoCorrect={false}
        style={{ flex: 1, paddingVertical: 12, fontSize: 15, color: c.text }}
      />
      {value ? (
        <Pressable onPress={() => onChange('')} hitSlop={10}>
          <Ionicons name="close-circle" size={18} color={c.textFaint} />
        </Pressable>
      ) : null}
    </Row>
  );
}

/**
 * One problem. The grade reads as the gym writes it, so a colour graded gym
 * shows a colour where a V scale gym shows a number, and the hold colour sits
 * beside it as the thing you actually look for from across the room.
 */
function RouteRow({ route }: { route: RouteWithStats }) {
  const c = useColors();
  const gradeIsColor = !!route.grade_hex;
  const gone = !!route.stripped_on;

  return (
    <Pressable onPress={() => router.push(`/route/${route.id}`)}>
      {/* Dimmed rather than hidden: still readable, clearly not today's. */}
      <Card style={gone ? { opacity: 0.55 } : undefined}>
        <Row>
          <View
            style={{
              width: 4,
              height: 38,
              borderRadius: 2,
              backgroundColor: holdHex(route.hold_color),
            }}
          />
          {gradeIsColor ? (
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: route.grade_hex!,
                borderWidth: 1,
                borderColor: c.border,
              }}
            />
          ) : (
            <Text style={{ color: c.text, fontSize: 19, fontWeight: '800', minWidth: 46 }}>
              {route.grade_label ?? '—'}
            </Text>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            {route.name ? (
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{route.name}</Text>
            ) : gradeIsColor ? (
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>
                {route.grade_label}
              </Text>
            ) : null}
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>
              {[
                gone ? 'Off the wall' : null,
                route.hold_color ? `${route.hold_color} holds` : null,
                route.setter,
                route.climber_count > 0
                  ? `sent by ${route.climber_count}`
                  : gone
                    ? null
                    : 'nobody has sent it',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          {route.rating != null ? (
            <Row style={{ gap: 2 }}>
              <Ionicons name="star" size={13} color={c.accent} />
              <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: '600' }}>
                {route.rating}
              </Text>
            </Row>
          ) : null}
          <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
        </Row>
      </Card>
    </Pressable>
  );
}

/** A modal that fills the screen and scrolls, which both sheets here want. */
function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const c = useColors();
  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
        <View style={{ paddingHorizontal: Spacing.four, paddingTop: Spacing.four }}>
          <Row>
            <Text style={{ color: c.text, fontSize: 22, fontWeight: '800', flex: 1 }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={26} color={c.textSecondary} />
            </Pressable>
          </Row>
        </View>
        <ScrollView
          contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six }}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/**
 * Setting a gym up: how it grades, and what its walls are called.
 *
 * V and Font are published ladders the database fills in, so those gyms only
 * answer the walls question. A colour graded gym has to give its own ladder,
 * in its own order, because the order is the only thing that says which
 * colour is harder and no two gyms agree on it.
 */
function SetUpSheet({
  open,
  gym,
  walls,
  userId,
  onClose,
  onSaved,
}: {
  open: boolean;
  gym: Gym | null;
  walls: GymWall[];
  userId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const c = useColors();
  const [system, setSystem] = useState<GradingSystemId | null>(null);
  const [ladder, setLadder] = useState<string[]>([]);
  const [wallNames, setWallNames] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Reopening should show the gym as it is now, not as it was the last time
  // this sheet was closed.
  useEffect(() => {
    if (!open) return;
    setSystem(gym?.grading_system ?? null);
    setWallNames(walls.map((w) => w.name));
    setLadder([]);
    setDraft('');
    setError('');
  }, [open, gym, walls]);

  function toggleColor(id: string) {
    setLadder((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }

  function commitDraft() {
    const name = draft.trim();
    if (!name) return;
    setWallNames((w) => (w.includes(name) ? w : [...w, name]));
    setDraft('');
  }

  async function save() {
    if (!userId || !gym || !system) return;
    if (system === 'color' && ladder.length < 2) {
      setError('Tap the colours in order, easiest first, so the app knows which is harder.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const names = draft.trim() && !wallNames.includes(draft.trim())
        ? [...wallNames, draft.trim()]
        : wallNames;
      await setUpGym({ gymId: gym.id, system, walls: names, colorLadder: ladder, userId });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title={`Set up ${gym?.name ?? 'this gym'}`} onClose={onClose}>
      <SectionLabel>How does this gym grade?</SectionLabel>
      <View style={{ gap: Spacing.two }}>
        {GRADING_SYSTEMS.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => setSystem(s.id)}
            style={{
              borderWidth: 1,
              borderColor: system === s.id ? c.accent : c.border,
              backgroundColor: system === s.id ? c.accentSoft : c.surface,
              borderRadius: Radius.md,
              padding: Spacing.three,
              gap: 2,
            }}>
            <Row>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 15, flex: 1 }}>{s.label}</Text>
              <Text style={{ color: c.textSecondary, fontSize: 13 }}>{s.example}</Text>
            </Row>
            <Text style={{ color: c.textFaint, fontSize: 13 }}>{s.hint}</Text>
          </Pressable>
        ))}
      </View>

      {system === 'color' ? (
        <>
          <SectionLabel>Its colours, easiest first</SectionLabel>
          <Text style={{ color: c.textFaint, fontSize: 13, marginTop: -Spacing.two }}>
            Tap them in the order this gym puts them in. That order is the grade.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
            {HOLD_COLORS.map((h) => {
              const at = ladder.indexOf(h.id);
              return (
                <Chip
                  key={h.id}
                  label={at >= 0 ? `${at + 1}. ${h.label}` : h.label}
                  tint={h.hex}
                  selected={at >= 0}
                  onPress={() => toggleColor(h.id)}
                />
              );
            })}
          </View>
        </>
      ) : null}

      <SectionLabel>What are its walls called?</SectionLabel>
      <Text style={{ color: c.textFaint, fontSize: 13, marginTop: -Spacing.two }}>
        The names already written above them. Cave, slab, comp wall, whatever this gym uses.
      </Text>
      {wallNames.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
          {wallNames.map((n) => (
            <Chip
              key={n}
              label={`${n}  ✕`}
              selected
              onPress={() => setWallNames((w) => w.filter((x) => x !== n))}
            />
          ))}
        </View>
      ) : null}
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={commitDraft}
        blurOnSubmit={false}
        returnKeyType="done"
        placeholder="Type a wall name, then return"
        placeholderTextColor={c.textFaint}
        style={{
          backgroundColor: c.surfaceSunken,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: Radius.md,
          paddingHorizontal: Spacing.three,
          paddingVertical: 14,
          fontSize: 16,
          color: c.text,
        }}
      />

      {error ? <Text style={{ color: c.fall, fontSize: 14 }}>{error}</Text> : null}

      {busy ? (
        <ActivityIndicator color={c.accent} />
      ) : (
        <Button label="Save" onPress={save} disabled={!system} />
      )}
    </Sheet>
  );
}

/**
 * Adding a problem.
 *
 * Every field here is something written on the wall or visible from the floor.
 * Nothing asks for an opinion, and nothing asks anybody to invent a name for a
 * climb somebody else set.
 */
function AddRouteSheet({
  open,
  gymId,
  grades,
  walls,
  userId,
  onClose,
  onAdded,
}: {
  open: boolean;
  gymId: string;
  grades: GymGrade[];
  walls: GymWall[];
  userId?: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const c = useColors();
  const [gradeId, setGradeId] = useState<string | null>(null);
  const [hold, setHold] = useState<string | null>(null);
  const [wallId, setWallId] = useState<string | null>(null);
  const [newWall, setNewWall] = useState('');
  const [name, setName] = useState('');
  const [setter, setSetter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setGradeId(null);
    setHold(null);
    setWallId(walls.length === 1 ? walls[0].id : null);
    setNewWall('');
    setName('');
    setSetter('');
    setError('');
  }, [open, walls]);

  const field = {
    backgroundColor: c.surfaceSunken,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    fontSize: 16,
    color: c.text,
  };

  async function save() {
    if (!userId) return;
    if (!gradeId) {
      setError('Pick the grade the gym gives it.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // A wall nobody had registered yet gets added to the gym rather than
      // stored on this one route, so the next person sees it as a chip.
      let wall = wallId;
      if (!wall && newWall.trim()) {
        wall = (await addWall(gymId, newWall, userId)).id;
      }
      await addRoute({
        gymId,
        gradeId,
        wallId: wall,
        holdColor: hold,
        name,
        setter,
        createdBy: userId,
      });
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const chosen = grades.find((g) => g.id === gradeId);

  return (
    <Sheet open={open} title="Add a problem" onClose={onClose}>
      <SectionLabel>Grade</SectionLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
        {grades.map((g) => (
          <Chip
            key={g.id}
            label={g.label}
            tint={g.color_hex ?? undefined}
            selected={gradeId === g.id}
            onPress={() => setGradeId(g.id)}
          />
        ))}
      </View>

      <SectionLabel>Hold colour</SectionLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
        {HOLD_COLORS.map((h) => (
          <Chip
            key={h.id}
            label={h.label}
            tint={h.hex}
            selected={hold === h.id}
            onPress={() => setHold(hold === h.id ? null : h.id)}
          />
        ))}
      </View>

      <SectionLabel>Which wall</SectionLabel>
      {walls.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
          {walls.map((w) => (
            <Chip
              key={w.id}
              label={w.name}
              selected={wallId === w.id}
              onPress={() => {
                setWallId(wallId === w.id ? null : w.id);
                setNewWall('');
              }}
            />
          ))}
        </View>
      ) : null}
      {!wallId ? (
        <TextInput
          value={newWall}
          onChangeText={setNewWall}
          placeholder={walls.length ? 'A wall not listed above' : 'Cave, slab, main wall…'}
          placeholderTextColor={c.textFaint}
          style={field}
        />
      ) : null}

      <SectionLabel>Name on the tag</SectionLabel>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Only if the gym wrote one (optional)"
        placeholderTextColor={c.textFaint}
        style={field}
      />

      {/* There are no setter accounts, because gyms are not partners here. The
          name is often chalked next to the tape, so it is worth keeping when
          somebody happens to know it. */}
      <SectionLabel>Setter</SectionLabel>
      <TextInput
        value={setter}
        onChangeText={setSetter}
        placeholder="Who set it, if you know (optional)"
        placeholderTextColor={c.textFaint}
        style={field}
      />

      {error ? <Text style={{ color: c.fall, fontSize: 14 }}>{error}</Text> : null}

      {busy ? (
        <ActivityIndicator color={c.accent} />
      ) : (
        <Button label={chosen ? `Add ${chosen.label}` : 'Add problem'} onPress={save} />
      )}
    </Sheet>
  );
}
