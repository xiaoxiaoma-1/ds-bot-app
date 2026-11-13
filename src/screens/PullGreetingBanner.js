import React from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

// Cream background and dark ink are fixed brand values for this banner.
const CREAM = '#F5F1E8';
const INK = '#2B2B2B';

// Fully driven by the pull gesture value: -220px pull -> 220px height, 0 -> 0.
const PULL_RANGE = [-220, 0];
const HEIGHT_RANGE = [220, 0];

export default function PullGreetingBanner({ pullProgress, greeting, dateText, insetsTop }) {
  const { T, S } = useTheme();

  const height = pullProgress.interpolate({
    inputRange: PULL_RANGE,
    outputRange: HEIGHT_RANGE,
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.banner, { height, backgroundColor: CREAM }]}
    >
      <View style={[styles.content, { paddingTop: insetsTop + S.x5 }]}>
        <Text style={[T.display, styles.greeting]} numberOfLines={1}>
          {greeting}
        </Text>
        <Text style={[T.body, styles.date]} numberOfLines={1}>
          {dateText}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    elevation: 10,
    overflow: 'hidden',
    // No radius, no border, no separator: one continuous full-bleed surface.
  },
  content: {
    width: '100%',
    alignItems: 'center',
    overflow: 'hidden',
  },
  greeting: {
    color: INK,
    textAlign: 'center',
  },
  date: {
    marginTop: 4,
    color: INK,
    textAlign: 'center',
  },
});
