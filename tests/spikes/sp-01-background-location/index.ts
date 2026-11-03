// The location task must be defined before the root component registers (expo-task-manager).
import './src/client/location-task.ts';
import { registerRootComponent } from 'expo';
import App from './App.tsx';

registerRootComponent(App);
