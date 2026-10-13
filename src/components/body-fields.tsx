/**
 * Handle, height, wingspan and weight, as a reusable block.
 *
 * The same fields are asked for once at sign up and edited later on the
 * profile screen. Two copies would drift, and the unit handling is the fiddly
 * part nobody wants to write twice.
 *
 * Wingspan is asked for rather than ape index because that is the number
 * people know about themselves, and the subtraction happens on the way to the
 * database. Plenty of climbers do not know it at all, so it is optional and
 * says how to measure it rather than pretending everybody has the answer.
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Chip, Row, SectionLabel, useColors } from '@/components/ui-kit';
import { Radius, Spacing } from '@/constants/theme';
import {
  apeIndexFrom,
  apeLabel,
  cmToFtIn,
  ftInToCm,
  HANDLE_PATTERN,
  kgToLb,
  lbToKg,
  Units,
  wingspanFrom,
} from '@/lib/profile';

export type BodyDraft = {
  handle: string;
  heightCm: number | null;
  wingspanCm: number | null;
  weightKg: number | null;
};

/**
 * What is wrong with a draft, or null when it is ready to save.
 *
 * `requireHeight` is off on the profile screen, where somebody who declined to
 * give their measurements should still be able to change their name without
 * being made to hand them over on the way past.
 */
export function bodyProblem(
  draft: BodyDraft,
  { requireHeight = true }: { requireHeight?: boolean } = {}
): string | null {
  // Optional everywhere: a video is signed with a display name, and the handle
  // is the extra people link to. Only a handle somebody actually typed has to
  // be a valid one.
  if (draft.handle && !HANDLE_PATTERN.test(draft.handle)) {
    return 'Handles are 3 to 20 characters: lower case letters, numbers and underscores.';
  }
  if (draft.weightKg != null && (draft.weightKg < 25 || draft.weightKg > 250)) {
    return 'That weight does not look right.';
  }
  if (draft.heightCm == null) {
    if (requireHeight) return 'Height is the one that has to be there.';
    // A wingspan with no height is not a measurement of anything, since ape
    // index is the difference between the two.
    if (draft.wingspanCm != null) return 'Height is needed to make sense of that wingspan.';
    return null;
  }
  if (draft.heightCm < 120 || draft.heightCm > 230) return 'That height does not look right.';
  if (draft.wingspanCm != null && Math.abs(draft.wingspanCm - draft.heightCm) > 30) {
    return 'That wingspan is a long way from that height. Worth a second look.';
  }
  return null;
}

export function BodyFields({
  value,
  onChange,
}: {
  value: BodyDraft;
  onChange: (next: BodyDraft) => void;
}) {
  const c = useColors();
  const [units, setUnits] = useState<Units>('imperial');
  const [howTo, setHowTo] = useState(false);

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

  const ape =
    value.heightCm != null && value.wingspanCm != null
      ? apeIndexFrom(value.heightCm, value.wingspanCm)
      : null;

  return (
    <>
      <SectionLabel>Handle</SectionLabel>
      <Row
        style={{
          backgroundColor: c.surfaceSunken,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: Radius.md,
          paddingHorizontal: Spacing.three,
        }}>
        <Text style={{ color: c.textFaint, fontSize: 16 }}>@</Text>
        <TextInput
          value={value.handle}
          onChangeText={(t) =>
            onChange({ ...value, handle: t.toLowerCase().replace(/[^a-z0-9_]/g, '') })
          }
          placeholder="whatpeoplecallyou"
          placeholderTextColor={c.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1, paddingVertical: 14, fontSize: 16, color: c.text }}
        />
      </Row>

      <Row style={{ marginTop: Spacing.two }}>
        <SectionLabel>Your build</SectionLabel>
        <View style={{ flex: 1 }} />
        <Chip label="ft / lb" selected={units === 'imperial'} onPress={() => setUnits('imperial')} />
        <Chip label="cm / kg" selected={units === 'metric'} onPress={() => setUnits('metric')} />
      </Row>

      <LengthInput
        label="Height"
        units={units}
        valueCm={value.heightCm}
        onChangeCm={(cm) => onChange({ ...value, heightCm: cm })}
        style={field}
      />

      <LengthInput
        label="Wingspan"
        optional
        units={units}
        valueCm={value.wingspanCm}
        onChangeCm={(cm) => onChange({ ...value, wingspanCm: cm })}
        style={field}
      />

      {/* Most people have never measured this, and the ones who have want to
          know what it means. Both answers live behind one line rather than
          taking up the form. */}
      <Pressable onPress={() => setHowTo(!howTo)} hitSlop={6}>
        <Text style={{ color: c.accent, fontSize: 13 }}>
          {howTo ? 'Hide' : 'Do not know your wingspan?'}
        </Text>
      </Pressable>
      {howTo ? (
        <View style={{ gap: Spacing.one, paddingBottom: Spacing.one }}>
          <Text style={{ color: c.textSecondary, fontSize: 13, lineHeight: 19 }}>
            Stand against a wall with your arms straight out to the sides and measure fingertip to
            fingertip. It takes about a minute with someone else holding the tape, and it is worth
            knowing once.
          </Text>
          <Text style={{ color: c.textSecondary, fontSize: 13, lineHeight: 19 }}>
            Leaving it blank is fine. 3B then matches beta on height alone, which still narrows it
            down. It will not guess a number for you: a made up wingspan sends you the wrong beta
            and looks exactly like a real one.
          </Text>
        </View>
      ) : null}

      {ape != null ? (
        <Text style={{ color: c.textSecondary, fontSize: 13 }}>
          Ape index {apeLabel(ape)}.{' '}
          {ape > 2
            ? 'Your reach beats your height, so long moves suit you.'
            : ape < -2
              ? 'Your reach is shorter than your height, so tight, footwork heavy beta suits you.'
              : 'Reach and height about even.'}
        </Text>
      ) : null}

      <WeightInput
        units={units}
        valueKg={value.weightKg}
        onChangeKg={(kg) => onChange({ ...value, weightKg: kg })}
        style={field}
      />
    </>
  );
}

/**
 * One length, entered in whichever unit is selected.
 *
 * Kept as strings while being typed rather than parsed on every keystroke, so
 * clearing the field to retype does not snap back to a stale number.
 */
function LengthInput({
  label,
  optional,
  units,
  valueCm,
  onChangeCm,
  style,
}: {
  label: string;
  optional?: boolean;
  units: Units;
  valueCm: number | null;
  onChangeCm: (cm: number | null) => void;
  style: object;
}) {
  const c = useColors();
  const [cm, setCm] = useState('');
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');

  // Refilled when the unit changes or the value arrives from the database,
  // but never while the person is typing in the unit they picked.
  useEffect(() => {
    if (units === 'metric') {
      setCm(valueCm != null ? String(valueCm) : '');
    } else if (valueCm != null) {
      const { feet: f, inches: i } = cmToFtIn(valueCm);
      setFeet(String(f));
      setInches(String(i));
    } else {
      setFeet('');
      setInches('');
    }
    // Deliberately not depending on valueCm: that would fight the keyboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units]);

  function pushFtIn(f: string, i: string) {
    const ft = parseInt(f, 10);
    const inch = i === '' ? 0 : parseInt(i, 10);
    onChangeCm(Number.isFinite(ft) ? ftInToCm(ft, Number.isFinite(inch) ? inch : 0) : null);
  }

  return (
    <View style={{ gap: Spacing.one }}>
      <Row>
        <Text style={{ color: c.textSecondary, fontSize: 14 }}>{label}</Text>
        {optional ? <Text style={{ color: c.textFaint, fontSize: 12 }}>optional</Text> : null}
      </Row>
      {units === 'metric' ? (
        <TextInput
          value={cm}
          onChangeText={(t) => {
            const digits = t.replace(/[^0-9]/g, '');
            setCm(digits);
            onChangeCm(digits ? parseInt(digits, 10) : null);
          }}
          placeholder="cm"
          placeholderTextColor={c.textFaint}
          keyboardType="number-pad"
          maxLength={3}
          style={style}
        />
      ) : (
        <Row>
          <TextInput
            value={feet}
            onChangeText={(t) => {
              const d = t.replace(/[^0-9]/g, '').slice(0, 1);
              setFeet(d);
              pushFtIn(d, inches);
            }}
            placeholder="5"
            placeholderTextColor={c.textFaint}
            keyboardType="number-pad"
            style={[style, { flex: 1 }]}
          />
          <Text style={{ color: c.textSecondary, fontSize: 15 }}>ft</Text>
          <TextInput
            value={inches}
            onChangeText={(t) => {
              const d = t.replace(/[^0-9]/g, '').slice(0, 2);
              setInches(d);
              pushFtIn(feet, d);
            }}
            placeholder="10"
            placeholderTextColor={c.textFaint}
            keyboardType="number-pad"
            style={[style, { flex: 1 }]}
          />
          <Text style={{ color: c.textSecondary, fontSize: 15 }}>in</Text>
        </Row>
      )}
    </View>
  );
}

/**
 * Weight, and the one field worth explaining before asking.
 *
 * It is the most personal number on the form and the easiest to skip out of
 * irritation, so the reason sits next to it: on anything steep, whether a move
 * goes is strength against bodyweight, which is why two climbers the same
 * height climb the same problem completely differently.
 */
function WeightInput({
  units,
  valueKg,
  onChangeKg,
  style,
}: {
  units: Units;
  valueKg: number | null;
  onChangeKg: (kg: number | null) => void;
  style: object;
}) {
  const c = useColors();
  const [text, setText] = useState('');

  useEffect(() => {
    if (valueKg == null) {
      setText('');
      return;
    }
    setText(String(units === 'metric' ? valueKg : kgToLb(valueKg)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units]);

  return (
    <View style={{ gap: Spacing.one }}>
      <Row>
        <Text style={{ color: c.textSecondary, fontSize: 14 }}>Weight</Text>
        <Text style={{ color: c.textFaint, fontSize: 12 }}>optional</Text>
      </Row>
      <TextInput
        value={text}
        onChangeText={(t) => {
          const digits = t.replace(/[^0-9]/g, '').slice(0, 3);
          setText(digits);
          if (!digits) {
            onChangeKg(null);
            return;
          }
          const n = parseInt(digits, 10);
          onChangeKg(units === 'metric' ? n : lbToKg(n));
        }}
        placeholder={units === 'metric' ? 'kg' : 'lb'}
        placeholderTextColor={c.textFaint}
        keyboardType="number-pad"
        style={style}
      />
      <Text style={{ color: c.textFaint, fontSize: 12, lineHeight: 17 }}>
        Used for what the analysis says about your own climbing, where pulling through steep ground
        is strength against bodyweight. Never shown to anybody else, and not used to sort beta.
      </Text>
    </View>
  );
}

/** Turn a stored profile into a draft the fields can edit. */
export function draftFrom(p: {
  handle: string | null;
  height_cm: number | null;
  ape_index_cm: number | null;
  weight_kg: number | null;
}): BodyDraft {
  return {
    handle: p.handle ?? '',
    heightCm: p.height_cm,
    wingspanCm:
      p.height_cm != null && p.ape_index_cm != null
        ? wingspanFrom(p.height_cm, p.ape_index_cm)
        : null,
    weightKg: p.weight_kg,
  };
}
