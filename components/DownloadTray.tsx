import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { usePalette } from '@/hooks/use-palette';
import {
  DownloadEvents,
  type DownloadErrorEvent,
  type ReelData,
} from '@/services/download';

interface Job {
  id: string;
  percentage: number;
}

interface Toast {
  key: string;
  text: string;
  kind: 'success' | 'error';
}

const TOAST_MS = 4000;

/**
 * Global download surface: one row per active download with real percentage,
 * plus short success/failure toasts. Replaces the old always-on debug log.
 */
export function DownloadTray() {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const toastSeq = useRef(0);

  const pushToast = useCallback((text: string, kind: Toast['kind']) => {
    toastSeq.current += 1;
    const key = `t${toastSeq.current}`;
    setToasts(prev => [...prev.slice(-2), { key, text, kind }]);
  }, []);

  const dropToast = useCallback((key: string) => {
    setToasts(prev => prev.filter(t => t.key !== key));
  }, []);

  useEffect(() => {
    const handleProgress = ({ postId, percentage }: { postId: string; percentage: number }) => {
      setDismissed(false);
      setJobs(prev => {
        const index = prev.findIndex(job => job.id === postId);
        if (index === -1) return [...prev, { id: postId, percentage }];
        const next = [...prev];
        next[index] = { id: postId, percentage };
        return next;
      });
    };

    const handleSuccess = (reel: ReelData) => {
      setJobs(prev => prev.filter(job => job.id !== reel.id));
      pushToast(reel.author ? `Saved @${reel.author}` : `Saved ${reel.id}`, 'success');
    };

    const handleError = ({ postId, message }: DownloadErrorEvent) => {
      setJobs(prev => prev.filter(job => job.id !== postId));
      pushToast(message, 'error');
    };

    DownloadEvents.on('progress', handleProgress);
    DownloadEvents.on('success', handleSuccess);
    DownloadEvents.on('error', handleError);
    return () => {
      DownloadEvents.off('progress', handleProgress);
      DownloadEvents.off('success', handleSuccess);
      DownloadEvents.off('error', handleError);
    };
  }, [pushToast]);

  const handleHide = () => {
    setDismissed(true);
    setJobs([]);
  };

  const hasJobs = jobs.length > 0;
  const showJobs = hasJobs && !dismissed;

  if (!showJobs && toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { bottom: insets.bottom + 64 }]}
    >
      {showJobs && (
        <View
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: palette.text }]}>
              {jobs.length === 1 ? 'Downloading 1 reel' : `Downloading ${jobs.length} reels`}
            </Text>
            <Pressable
              onPress={handleHide}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Hide download progress"
            >
              <Ionicons name="close" size={18} color={palette.textMuted} />
            </Pressable>
          </View>

          {jobs.map(job => (
            <View key={job.id} style={styles.job}>
              <View style={styles.jobTextRow}>
                <Text style={[styles.jobId, { color: palette.textMuted }]} numberOfLines={1}>
                  {job.id}
                </Text>
                <Text style={[styles.jobPct, { color: palette.text }]}>{job.percentage}%</Text>
              </View>
              <View style={[styles.barTrack, { backgroundColor: palette.surfaceAlt }]}>
                <View
                  style={[
                    styles.barFill,
                    { backgroundColor: palette.accent, width: `${job.percentage}%` },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
      )}

      {toasts.map(toast => (
        <ToastRow key={toast.key} toast={toast} onDone={dropToast} />
      ))}
    </View>
  );
}

function ToastRow({ toast, onDone }: { toast: Toast; onDone: (key: string) => void }) {
  const palette = usePalette();

  useEffect(() => {
    const timer = setTimeout(() => onDone(toast.key), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.key, onDone]);

  const isError = toast.kind === 'error';

  return (
    <Pressable
      onPress={() => onDone(toast.key)}
      accessibilityRole="button"
      accessibilityLabel={isError ? `Download failed: ${toast.text}` : toast.text}
      style={[
        styles.toast,
        {
          backgroundColor: palette.surface,
          borderColor: isError ? palette.danger : palette.success,
        },
      ]}
    >
      <Ionicons
        name={isError ? 'alert-circle' : 'checkmark-circle'}
        size={18}
        color={isError ? palette.danger : palette.success}
      />
      <Text style={[styles.toastText, { color: palette.text }]} numberOfLines={3}>
        {toast.text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 12,
    right: 12,
    gap: 8,
    zIndex: 100,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  job: {
    gap: 6,
  },
  jobTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  jobId: {
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  jobPct: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  barTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  toastText: {
    flex: 1,
    fontSize: 13,
  },
});
