import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { DownloadEvents } from '../services/download';

export const DownloadProgressOverlay = React.memo(() => {
  const [logs, setLogs] = useState<string[]>(['Ready to download']);
  const [progressFiles, setProgressFiles] = useState<{ [key: string]: number }>({});

  useEffect(() => {
    const handleLog = (msg: string) => {
      setLogs((prev) => [...prev, msg].slice(-5));
    };

    const handleProgress = ({ postId, percentage }: { postId: string; percentage: number }) => {
      setProgressFiles((prev) => ({ ...prev, [postId]: percentage }));
      if (percentage === 100) {
        setTimeout(() => {
          setProgressFiles((prev) => {
            const copy = { ...prev };
            delete copy[postId];
            return copy;
          });
        }, 3000);
      }
    };

    DownloadEvents.on('log', handleLog);
    DownloadEvents.on('progress', handleProgress);

    return () => {
      DownloadEvents.off('log', handleLog);
      DownloadEvents.off('progress', handleProgress);
    };
  }, []);

  const activeDownloads = Object.entries(progressFiles);

  return (
    <View style={styles.overlay} pointerEvents="none">
      {activeDownloads.map(([postId, percent]) => (
        <View key={postId} style={styles.progressContainer}>
          <Text style={styles.progressText}>Downloading {postId.slice(0, 10)}...: {percent}%</Text>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${percent}%` }]} />
          </View>
        </View>
      ))}
      {logs.map((logStr, index) => (
        <Text key={index} style={styles.logText}>{logStr}</Text>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    bottom: 100, // Matches the height of the bottom tabs roughly
    left: 10,
    right: 10,
    zIndex: 10,
    gap: 6,
    alignItems: 'flex-start',
  },
  progressContainer: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 12,
    borderRadius: 8,
    width: '100%',
    borderWidth: 1,
    borderColor: '#333',
  },
  progressText: {
    color: 'white',
    fontSize: 13,
    marginBottom: 8,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#007AFF',
  },
  logText: {
    color: '#0f0',
    fontSize: 11,
    fontFamily: 'monospace',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
});
