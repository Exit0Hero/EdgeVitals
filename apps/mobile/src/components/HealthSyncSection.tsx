import { CONSENT_POLICY_VERSION } from '@edgevitals/domain';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, ApiError } from '../api/client';
import { forgetSync, lastSyncedAt, syncHealthNow, type SyncSummary } from '../lib/healthSync/sync';
import { healthStore } from '../lib/healthSync/store';
import type { Access, Availability } from '../lib/healthSync/types';
import { useSession } from '../state/session';
import { colors, space } from '../theme/tokens';
import { Banner, PrimaryButton, Segmented, T, TextButton } from './ui';

const time = (d: Date) =>
  d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

function summaryText(s: SyncSummary) {
  const parts = [`${s.inserted} new`];
  if (s.updated) parts.push(`${s.updated} updated`);
  if (s.skipped) parts.push(`${s.skipped} left out (values outside the possible range)`);
  return parts.join(', ');
}

/**
 * Settings: read SpO2 and blood pressure from Health Connect / Apple Health
 * (ADR 0009). Turning it on records the optional `health_sync` consent after
 * the system permission sheet; turning it off withdraws the consent and, on
 * Android, removes EdgeVitals' Health Connect access.
 */
export function HealthSyncSection() {
  const { me, refreshMe } = useSession();
  const store = healthStore;
  const storeName = store?.name ?? 'your phone’s health app';
  const consent = me?.consents.health_sync;
  const on = !!consent?.active;
  const [availability, setAvailability] = useState<Availability | null>(
    store ? null : 'unavailable',
  );
  const [access, setAccess] = useState<Access | null>(null);
  const [last, setLast] = useState<Date | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{
    tone: 'info' | 'danger' | 'warning';
    title: string;
    body?: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!store || !me) return;
    const a = await store.availability().catch(() => 'unavailable' as const);
    setAvailability(a);
    if (a === 'available') setAccess(await store.grantedAccess().catch(() => null));
    setLast(await lastSyncedAt(me.id));
  }, [store, me]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!me) return null;

  const fail = (e: unknown, fallback: string) =>
    setMsg({
      tone: 'danger',
      title: fallback,
      body: e instanceof ApiError ? e.message : e instanceof Error ? e.message : undefined,
    });

  const sync = async () => {
    setBusy('sync');
    setMsg(null);
    try {
      const s = await syncHealthNow(me.id);
      setLast(new Date(s.at));
      setMsg({
        tone: 'info',
        title: s.read ? 'Synced' : 'Synced, nothing new',
        body: s.read
          ? summaryText(s)
          : `No SpO₂ or blood pressure readings found in ${storeName} since the last sync.`,
      });
    } catch (e) {
      fail(e, 'Could not sync');
    } finally {
      setBusy(null);
    }
  };

  const turnOn = async () => {
    if (!store) return;
    setBusy('toggle');
    setMsg(null);
    try {
      const a = await store.availability();
      setAvailability(a);
      if (a !== 'available') {
        setMsg({
          tone: 'warning',
          title:
            a === 'needs_update'
              ? `${store.name} needs an update`
              : `${store.name} is not available`,
          body:
            a === 'needs_update'
              ? `Update ${store.name} from the Play Store, then try again.`
              : `This phone does not have ${store.name}.`,
        });
        return;
      }
      // The system sheet first: if nothing is allowed there, no consent is recorded.
      const granted = await store.requestAccess();
      setAccess(granted);
      if (granted.spo2 === false && granted.blood_pressure === false) {
        setMsg({
          tone: 'warning',
          title: 'Nothing was allowed',
          body: `Allow EdgeVitals to read oxygen saturation or blood pressure in ${store.name} to turn this on.`,
        });
        return;
      }
      await api.grantConsent('health_sync', true, CONSENT_POLICY_VERSION);
      await refreshMe();
      setBusy('sync');
      const s = await syncHealthNow(me.id);
      setLast(new Date(s.at));
      setMsg({
        tone: 'info',
        title: 'Sync is on',
        body: s.read
          ? `First sync: ${summaryText(s)}.`
          : `Connected. No SpO₂ or blood pressure readings were found in ${store.name} for the last 30 days yet.`,
      });
    } catch (e) {
      fail(e, 'Could not turn on sync');
    } finally {
      setBusy(null);
    }
  };

  const turnOff = async () => {
    setBusy('toggle');
    setMsg(null);
    try {
      if (consent?.record_id) await api.withdrawConsent(consent.record_id);
      await refreshMe();
      await forgetSync(me.id);
      setLast(null);
      const revoked = store ? await store.revoke().catch(() => false) : false;
      setAccess(revoked ? { spo2: false, blood_pressure: false } : access);
      setMsg({
        tone: 'info',
        title: 'Sync is off',
        body: revoked
          ? `EdgeVitals no longer has access to ${storeName}. Readings already copied stay until you delete them below.`
          : store?.platform === 'apple_health'
            ? 'EdgeVitals stops reading Apple Health. To remove its access fully, open Settings → Health → Data Access & Devices → EdgeVitals. Readings already copied stay until you delete them below.'
            : 'EdgeVitals stops reading your health app. Readings already copied stay until you delete them below.',
      });
    } catch (e) {
      fail(e, 'Could not turn off sync');
    } finally {
      setBusy(null);
    }
  };

  const deleteCopies = async () => {
    setBusy('delete');
    setMsg(null);
    try {
      const r = await api.deleteHealthSyncReadings();
      // Re-read everything next time if sync stays on.
      await forgetSync(me.id);
      setLast(null);
      setMsg({
        tone: 'info',
        title: r.deleted ? 'Synced readings deleted' : 'No synced readings to delete',
        body: r.deleted
          ? `${r.deleted} copied reading${r.deleted === 1 ? '' : 's'} removed from EdgeVitals. Nothing was removed from ${storeName}.`
          : undefined,
      });
    } catch (e) {
      fail(e, 'Could not delete synced readings');
    } finally {
      setBusy(null);
    }
  };

  const missing =
    on && access
      ? [
          access.spo2 === false ? 'oxygen saturation' : null,
          access.blood_pressure === false ? 'blood pressure' : null,
        ].filter(Boolean)
      : [];

  return (
    <View testID="health-sync-section">
      <T variant="body" color={colors.textSecondary} style={{ marginBottom: space[3] }}>
        {`Copy oxygen saturation (SpO₂) and blood pressure that your own watch, ring, oximeter or cuff saves to ${store ? store.name : 'Health Connect (Android) or Apple Health (iPhone)'}. EdgeVitals only reads these two types and never writes to ${store ? store.name : 'it'}. Each reading is labelled with the app and device that took it. They appear next to your scans but do not change your baseline or scores, and they are only as accurate as the device that recorded them.`}
      </T>
      {msg ? (
        <Banner tone={msg.tone} title={msg.title} body={msg.body} testID="health-sync-message" />
      ) : null}
      {store ? (
        <>
          <Segmented
            label={`Sync from ${store.name}`}
            testID="health-sync"
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
            ]}
            value={on ? 'on' : 'off'}
            onChange={(v) => {
              if (busy) return;
              if (v === 'on' && !on) turnOn();
              if (v === 'off' && on) turnOff();
            }}
          />
          <T
            variant="small"
            color={colors.muted}
            style={{ marginTop: space[2] }}
            testID="health-sync-status"
          >
            {busy === 'toggle'
              ? 'Working…'
              : on
                ? last
                  ? `On · last synced ${time(last)}`
                  : 'On · not synced yet'
                : availability === 'needs_update'
                  ? `Off · ${store.name} needs an update`
                  : availability === 'unavailable'
                    ? `Off · ${store.name} is not available on this phone`
                    : 'Off'}
          </T>
          {missing.length ? (
            <T variant="small" color={colors.warning} style={{ marginTop: space[1] }}>
              {`${store.name} has not allowed ${missing.join(' or ')}. Open ${store.name} to allow it.`}
            </T>
          ) : null}
          {on ? (
            <PrimaryButton
              label="Sync now"
              loading={busy === 'sync'}
              disabled={!!busy && busy !== 'sync'}
              onPress={sync}
              testID="health-sync-now"
              style={{ marginTop: space[3] }}
            />
          ) : null}
          <TextButton
            label={`Manage permissions in ${store.platform === 'health_connect' ? 'Health Connect' : 'Settings'}`}
            align="flex-start"
            onPress={() => store.openSettings().catch(() => undefined)}
            testID="health-sync-permissions"
          />
        </>
      ) : (
        <T variant="small" color={colors.muted} testID="health-sync-status">
          Sync runs in the EdgeVitals app on Android and iPhone.
        </T>
      )}
      <TextButton
        label="See synced readings"
        align="flex-start"
        onPress={() => router.push('/health-readings')}
        testID="health-sync-readings"
      />
      <TextButton
        label="Delete synced readings"
        align="flex-start"
        color={colors.danger}
        onPress={() => (busy ? undefined : deleteCopies())}
        testID="health-sync-delete"
      />
    </View>
  );
}
