import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface SignupStepBarProps {
  currentStep: number;
  totalSteps: number;
  stepLabels: string[];
}

export default function SignupStepBar({ currentStep, totalSteps, stepLabels }: SignupStepBarProps) {
  return (
    <View style={styles.container}>
      {stepLabels.map((label, index) => {
        const stepNumber = index + 1;
        const isDone = stepNumber < currentStep;
        const isActive = stepNumber === currentStep;
        const isUpcoming = stepNumber > currentStep;

        return (
          <React.Fragment key={stepNumber}>
            <View style={styles.stepItem}>
              <View style={[
                styles.circle,
                isDone && styles.circleDone,
                isActive && styles.circleActive,
                isUpcoming && styles.circleUpcoming,
              ]}>
                {isDone ? (
                  <Ionicons name="checkmark" size={13} color="#000" />
                ) : (
                  <Text style={[
                    styles.stepNumber,
                    isActive && styles.stepNumberActive,
                    isUpcoming && styles.stepNumberUpcoming,
                  ]}>
                    {stepNumber}
                  </Text>
                )}
              </View>
              <Text style={[
                styles.label,
                isActive && styles.labelActive,
                isUpcoming && styles.labelUpcoming,
              ]}>
                {label}
              </Text>
            </View>

            {index < totalSteps - 1 && (
              <View style={[styles.line, isDone && styles.lineDone]} />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  stepItem: {
    alignItems: 'center',
    gap: 5,
  },
  circle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  circleDone: {
    backgroundColor: '#fff',
  },
  circleActive: {
    backgroundColor: '#fff',
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  circleUpcoming: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  stepNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  stepNumberActive: {
    color: '#000',
  },
  stepNumberUpcoming: {
    color: 'rgba(255,255,255,0.4)',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
  },
  labelActive: {
    color: '#fff',
  },
  labelUpcoming: {
    color: 'rgba(255,255,255,0.35)',
  },
  line: {
    flex: 1,
    height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: 15,
    marginHorizontal: 6,
  },
  lineDone: {
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
});
