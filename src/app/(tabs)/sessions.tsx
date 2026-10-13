/**
 * Everything logged, newest first.
 *
 * A session is not a thing you start and stop. It is the sends that share a
 * day and a gym, worked out on the way to the screen, so nobody has to
 * remember to press anything while they are packing their shoes away.
 *
 * Two gyms in one day stay two sessions, because "Tuesday" is not a useful
 * heading when half of it happened somewhere else.
 */
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Card, Row, Screen, SectionLabel, useColors } from '@/components/ui-kit';
import { holdHex } from '@/constants/climbing';
import { Radius, Spacing } from '@/constants/theme';
import { dayLabel, listSessions, SendInContext, Session } from '@/lib/sends';

export default function SessionsScreen() {
  const c = useColors();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState('');

  // Reloaded on focus rather than on mount, because the way here is almost
  // always straight back from logging something on a route screen.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      setError('');
      listSessions()
        .then((s) => live && setSessions(s))
        .catch(
          (e) => live && setError(e instanceof Error ? e.message : 'Could not load your sessions.')
        );
      return () => {
        live = false;
      };
    }, [])
  );

  const total = sessions?.reduce((n, s) => n + s.sends.length, 0) ?? 0;

  return (
    <Screen
      title="Sessions"
      subtitle={
        sessions === null
          ? ''
          : total
            ? `${total} ${total === 1 ? 'send' : 'sends'} across ${sessions.length} ${
                sessions.length === 1 ? 'session' : 'sessions'
              }`
            : 'What you have sent, grouped by day'
      }>
      {error ? (
        <View style={{ backgroundColor: c.fallSoft, borderRadius: Radius.md, padding: Spacing.three }}>
          <Text style={{ color: c.fall, fontSize: 14 }}>{error}</Text>
        </View>
      ) : null}

      {sessions === null ? (
        <ActivityIndicator color={c.accent} style={{ paddingVertical: Spacing.five }} />
      ) : sessions.length === 0 ? (
        <Card style={{ alignItems: 'center', paddingVertical: Spacing.five, gap: Spacing.three }}>
          <Ionicons name="list-outline" size={30} color={c.textFaint} />
          <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>Nothing logged yet</Text>
          <Text
            style={{
              color: c.textSecondary,
              fontSize: 14,
              textAlign: 'center',
              lineHeight: 20,
              paddingHorizontal: Spacing.three,
            }}>
            Open a gym, tap a problem, and say you got it. That is the whole thing.
          </Text>
        </Card>
      ) : (
        sessions.map((s) => (
          <View key={s.key} style={{ gap: Spacing.two }}>
            <SectionLabel>{`${dayLabel(s.date)} · ${s.gym_name}`}</SectionLabel>
            <Text style={{ color: c.textFaint, fontSize: 12, marginTop: -Spacing.two }}>
              {s.sends.length} sent
            </Text>
            {s.sends.map((send) => (
              <SendRow key={send.id} send={send} />
            ))}
          </View>
        ))
      )}
    </Screen>
  );
}

function SendRow({ send }: { send: SendInContext }) {
  const c = useColors();
  const when = new Date(send.sent_at);

  return (
    <Pressable onPress={() => router.push(`/route/${send.route_id}`)}>
      <Card>
        <Row>
          <View
            style={{
              width: 4,
              height: 34,
              borderRadius: 2,
              backgroundColor: holdHex(send.hold_color),
            }}
          />
          {send.grade_hex ? (
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: send.grade_hex,
                borderWidth: 1,
                borderColor: c.border,
              }}
            />
          ) : (
            <Text style={{ color: c.text, fontSize: 17, fontWeight: '800', minWidth: 42 }}>
              {send.grade_label ?? '—'}
            </Text>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>
              {send.route_name || send.wall_name || 'Problem'}
            </Text>
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>
              {when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              {send.note ? ` · ${send.note}` : ''}
            </Text>
          </View>
          <Ionicons name="checkmark-circle" size={20} color={c.sent} />
        </Row>
      </Card>
    </Pressable>
  );
}
