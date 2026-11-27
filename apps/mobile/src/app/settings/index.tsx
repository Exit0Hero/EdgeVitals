import { CONSENT_POLICY_VERSION, profileSchema } from '@edgevitals/domain';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { api, ApiError } from '../../api/client';
import { HealthSyncSection } from '../../components/HealthSyncSection';
import { TimeField } from '../../components/TimeField';
import {
  BackHeader,
  Banner,
  Card,
  Field,
  PrimaryButton,
  Screen,
  Segmented,
  T,
  TextButton,
} from '../../components/ui';
import { deviceTimeZone, uuid } from '../../lib/id';
import {
  reminderPermission,
  remindersSupported,
  requestReminderPermission,
  type ReminderPermission,
} from '../../lib/reminders';
import { saveExport } from '../../lib/saveExport';
import { getExperimentalSpo2, setExperimentalSpo2 } from '../../lib/experimental';
import { useSession } from '../../state/session';
import { colors, space } from '../../theme/tokens';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: space[6] }}>
      <T variant="heading" accessibilityRole="header" style={{ marginBottom: space[3] }}>
        {title}
      </T>
      {children}
    </View>
  );
}

/** Profile, schedule, consent, export, deletion (FR-006, FR-011, doc 11 §6). Not drawn in the POC; follows its visual language. */
export default function Settings() {
  const { me, refreshMe, signOut } = useSession();
  const [msg, setMsg] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const [profile, setProfile] = useState(() => ({
    birth_year: String(me?.profile?.birth_year ?? ''),
    sex_at_birth: me?.profile?.sex_at_birth ?? null,
    height_cm: String(me?.profile?.height_cm ?? ''),
    weight_kg: String(me?.profile?.weight_kg ?? ''),
  }));
  const [schedule, setSchedule] = useState(() => me?.schedule ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [notif, setNotif] = useState<ReminderPermission>('undetermined');
  const [experimental, setExperimental] = useState<'off' | 'on'>('off');
  useEffect(() => {
    getExperimentalSpo2().then((on) => setExperimental(on ? 'on' : 'off'));
  }, []);
  useEffect(() => {
    reminderPermission()
      .then(setNotif)
      .catch(() => setNotif('unsupported'));
  }, []);

  if (!me) return null;

  // Leave the signed-in screens first, then clear the session, so the tab
  // layout's own signed-out redirect cannot stack a second welcome screen.
  const leave = () => {
    router.dismissAll();
    router.replace('/welcome');
    signOut().catch(() => undefined);
  };

  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'info', text: ok });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? e.message : 'Something went wrong' });
    } finally {
      setBusy(null);
    }
  };

  const parsedProfile = profileSchema.safeParse({
    birth_year: Number(profile.birth_year),
    sex_at_birth: profile.sex_at_birth,
    height_cm: Number(profile.height_cm),
    weight_kg: Number(profile.weight_kg),
  });

  const consentRow = (
    key: 'processing' | 'wellness_acknowledgement' | 'anonymous_improvement',
    label: string,
    required: boolean,
  ) => {
    const c = me.consents[key];
    return (
      <View
        key={key}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          gap: space[3],
        }}
      >
        <View style={{ flex: 1 }}>
          <T variant="body">{label}</T>
          <T variant="small" color={c.active ? colors.success : colors.muted}>
            {c.active ? 'On' : 'Off'}
            {required ? ' · required for scans' : ' · optional'}
          </T>
        </View>
        {c.active && c.record_id ? (
          <TextButton
            label="Withdraw"
            testID={`withdraw-${key}`}
            color={colors.danger}
            onPress={() =>
              run(
                `consent-${key}`,
                async () => {
                  await api.withdrawConsent(c.record_id!);
                  await refreshMe();
                },
                required
                  ? 'Consent withdrawn. Scans are paused until you agree again.'
                  : 'Optional consent withdrawn.',
              )
            }
          />
        ) : (
          <TextButton
            label="Turn on"
            testID={`grant-${key}`}
            onPress={() =>
              run(
                `consent-${key}`,
                async () => {
                  await api.grantConsent(key, true, CONSENT_POLICY_VERSION);
                  await refreshMe();
                },
                'Consent recorded.',
              )
            }
          />
        )}
      </View>
    );
  };

  return (
    <Screen testID="screen-settings">
      <BackHeader
        title="Settings"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/today'))}
      />
      {msg ? <Banner tone={msg.tone} title={msg.text} testID="settings-message" /> : null}

      <Section title="Profile">
        <Field
          label="Year of birth"
          keyboardType="number-pad"
          maxLength={4}
          value={profile.birth_year}
          onChangeText={(v) => setProfile((p) => ({ ...p, birth_year: v }))}
          testID="settings-birth-year"
        />
        <Segmented
          label="Sex at birth"
          value={profile.sex_at_birth}
          onChange={(v) => setProfile((p) => ({ ...p, sex_at_birth: v }))}
          options={[
            { value: 'female', label: 'Female' },
            { value: 'male', label: 'Male' },
          ]}
        />
        <View style={{ flexDirection: 'row', gap: space[3], marginTop: space[4] }}>
          <Field
            label="Height"
            suffix="cm"
            keyboardType="decimal-pad"
            value={profile.height_cm}
            onChangeText={(v) => setProfile((p) => ({ ...p, height_cm: v }))}
          />
          <Field
            label="Weight"
            suffix="kg"
            keyboardType="decimal-pad"
            value={profile.weight_kg}
            onChangeText={(v) => setProfile((p) => ({ ...p, weight_kg: v }))}
            testID="settings-weight"
          />
        </View>
        <PrimaryButton
          label="Save profile"
          disabled={!parsedProfile.success}
          loading={busy === 'profile'}
          testID="save-profile"
          onPress={() =>
            parsedProfile.success &&
            run(
              'profile',
              async () => {
                await api.saveProfile(parsedProfile.data);
                await refreshMe();
              },
              'Profile saved.',
            )
          }
        />
      </Section>

      {schedule ? (
        <Section title="Scan times and reminders">
          <TimeField
            title="Morning scan"
            subtitle="Soon after waking, before coffee"
            value={schedule.morning_time}
            onChange={(v) => setSchedule({ ...schedule, morning_time: v })}
          />
          <TimeField
            title="Evening scan"
            subtitle="Before winding down for bed"
            value={schedule.evening_time}
            onChange={(v) => setSchedule({ ...schedule, evening_time: v })}
          />
          <Segmented
            label="Reminders"
            value={schedule.reminders_enabled ? 'on' : 'off'}
            onChange={async (v) => {
              if (v === 'on' && remindersSupported) {
                const p = await requestReminderPermission().catch(() => 'denied' as const);
                setNotif(p);
                if (p === 'denied') return; // explained below; nothing would arrive
              }
              setSchedule({ ...schedule, reminders_enabled: v === 'on' });
            }}
            options={[
              { value: 'on', label: 'Reminders on' },
              { value: 'off', label: 'Reminders off' },
            ]}
          />
          <T
            variant="small"
            color={colors.muted}
            style={{ marginTop: space[2] }}
            testID="reminder-note"
          >
            {!remindersSupported
              ? 'Reminders arrive through the EdgeVitals app on iPhone and Android.'
              : notif === 'denied'
                ? 'Notifications are turned off for EdgeVitals in your phone settings.'
                : 'Reminders come from this phone at your local time and skip scans you have already done.'}
          </T>
          {remindersSupported && notif === 'denied' ? (
            <TextButton label="Open phone settings" onPress={() => Linking.openSettings()} />
          ) : null}
          <View style={{ height: space[3] }} />
          <PrimaryButton
            label="Save schedule"
            loading={busy === 'schedule'}
            testID="save-schedule"
            onPress={() =>
              run(
                'schedule',
                async () => {
                  await api.saveSchedule({ ...schedule, timezone: deviceTimeZone() });
                  await refreshMe();
                },
                'Schedule saved.',
              )
            }
          />
        </Section>
      ) : null}

      <Section title="Experimental estimates">
        <T variant="body" color={colors.textSecondary} style={{ marginBottom: space[3] }}>
          Adds an experimental oxygen saturation (SpO₂) estimate to your scans. It uses a published
          research method (Bal, 2015) that compares red and blue colour changes in your face.
          EdgeVitals has not validated it, it can be off by several points, and it can miss low
          oxygen. Do not use it for health decisions. Use a pulse oximeter if you are unwell.
        </T>
        <Segmented
          label="Experimental SpO₂ estimate"
          testID="experimental-spo2"
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
          value={experimental}
          onChange={(v) => {
            setExperimental(v);
            setExperimentalSpo2(v === 'on').catch(() => setExperimental(v === 'on' ? 'off' : 'on'));
          }}
        />
        <T variant="small" color={colors.muted} style={{ marginTop: space[2] }}>
          Blood pressure is not available from the camera. You can log readings from your own cuff
          in Trends, or sync them from your health app below.
        </T>
      </Section>

      <Section title="Health app sync">
        <HealthSyncSection />
      </Section>

      <Section title="Privacy and consent">
        {consentRow('processing', 'Process my readings for wellness insights', true)}
        {consentRow(
          'wellness_acknowledgement',
          'EdgeVitals is a wellness app, not a medical device',
          true,
        )}
        {consentRow('anonymous_improvement', 'Help improve EdgeVitals with anonymised data', false)}
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push('/privacy')}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <T variant="body" color={colors.primary}>
            Read the privacy policy
          </T>
        </Pressable>
      </Section>

      <Section title="Your data">
        <Card tone="surface" style={{ marginBottom: space[3] }}>
          <T variant="label">Export your data</T>
          <T variant="small" color={colors.muted} style={{ marginBottom: space[3] }}>
            A JSON file with your profile, consents, schedule, check-ins and readings.
          </T>
          <PrimaryButton
            label="Export"
            loading={busy === 'export'}
            testID="export-data"
            onPress={() =>
              run(
                'export',
                async () => {
                  const job = await api.requestExport(uuid());
                  const data = await api.downloadExport(job.id);
                  await saveExport(
                    `edgevitals-export-${new Date().toISOString().slice(0, 10)}.json`,
                    data,
                  );
                },
                'Your export is ready.',
              )
            }
          />
        </Card>
        <Card tone="surface">
          <T variant="label" color={colors.danger}>
            Delete account
          </T>
          <T variant="small" color={colors.muted} style={{ marginBottom: space[3] }}>
            Permanently deletes your account, profile, consents, check-ins and all readings. A
            record that a deletion happened is kept without any health data, and encrypted backups
            expire on our backup schedule. Type DELETE and your password to confirm.
          </T>
          <Field
            label="Type DELETE"
            value={confirmDelete}
            onChangeText={setConfirmDelete}
            autoCapitalize="characters"
            placeholder="DELETE"
            testID="delete-confirm"
          />
          <Field
            label="Password"
            value={deletePassword}
            onChangeText={setDeletePassword}
            secureTextEntry
            autoComplete="current-password"
            testID="delete-password"
          />
          <PrimaryButton
            label="Delete my account"
            disabled={confirmDelete !== 'DELETE' || !deletePassword}
            loading={busy === 'delete'}
            style={{
              backgroundColor:
                confirmDelete === 'DELETE' && deletePassword ? colors.danger : '#E8A39C',
            }}
            testID="delete-account"
            onPress={async () => {
              setBusy('delete');
              try {
                await api.deleteAccount(deletePassword);
                leave();
              } catch (e) {
                setMsg({
                  tone: 'danger',
                  text: e instanceof ApiError ? e.message : 'Could not delete account',
                });
                setBusy(null);
              }
            }}
          />
        </Card>
      </Section>

      <TextButton
        label="Sign out"
        onPress={async () => {
          leave();
        }}
        testID="sign-out"
      />
      <T variant="tiny" color={colors.muted} style={{ textAlign: 'center', marginTop: space[4] }}>
        Signed in as {me.email}
      </T>
    </Screen>
  );
}
