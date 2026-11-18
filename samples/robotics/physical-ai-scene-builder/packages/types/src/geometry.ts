// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type Vec3 = readonly [number, number, number];

/** Quaternion in MuJoCo order: w, x, y, z. */
export type Quat = readonly [number, number, number, number];

export type Rgba = readonly [number, number, number, number];

/** Mirrors `mjtGeom`. */
export const GeomType = {
  Plane: 0,
  HeightField: 1,
  Sphere: 2,
  Capsule: 3,
  Ellipsoid: 4,
  Cylinder: 5,
  Box: 6,
  Mesh: 7,
  Sdf: 8,
} as const;

export type GeomType = (typeof GeomType)[keyof typeof GeomType];

export const GEOM_TYPE_LABELS: Record<number, string> = {
  [GeomType.Plane]: 'plane',
  [GeomType.HeightField]: 'hfield',
  [GeomType.Sphere]: 'sphere',
  [GeomType.Capsule]: 'capsule',
  [GeomType.Ellipsoid]: 'ellipsoid',
  [GeomType.Cylinder]: 'cylinder',
  [GeomType.Box]: 'box',
  [GeomType.Mesh]: 'mesh',
  [GeomType.Sdf]: 'sdf',
};

/** Mirrors `mjtJoint`. */
export const JointType = {
  Free: 0,
  Ball: 1,
  Slide: 2,
  Hinge: 3,
} as const;

export type JointType = (typeof JointType)[keyof typeof JointType];

export const JOINT_TYPE_LABELS: Record<number, string> = {
  [JointType.Free]: 'free',
  [JointType.Ball]: 'ball',
  [JointType.Slide]: 'slide',
  [JointType.Hinge]: 'hinge',
};

/** Mirrors `mjtLightType`. */
export const LightType = {
  Spot: 0,
  Directional: 1,
  Point: 2,
  Image: 3,
} as const;

export type LightType = (typeof LightType)[keyof typeof LightType];

export const LIGHT_TYPE_LABELS: Record<number, string> = {
  [LightType.Spot]: 'spot',
  [LightType.Directional]: 'directional',
  [LightType.Point]: 'point',
  [LightType.Image]: 'image',
};

/** Mirrors `mjtSensor`. */
export const SensorType = {
  Touch: 0,
  Accelerometer: 1,
  Velocimeter: 2,
  Gyro: 3,
  Force: 4,
  Torque: 5,
  Magnetometer: 6,
  Rangefinder: 7,
  CamProjection: 8,
  JointPosition: 9,
  JointVelocity: 10,
  TendonPosition: 11,
  TendonVelocity: 12,
  ActuatorPosition: 13,
  ActuatorVelocity: 14,
  ActuatorForce: 15,
  JointActuatorForce: 16,
  TendonActuatorForce: 17,
  BallQuaternion: 18,
  BallAngularVelocity: 19,
  JointLimitPosition: 20,
  JointLimitVelocity: 21,
  JointLimitForce: 22,
  TendonLimitPosition: 23,
  TendonLimitVelocity: 24,
  TendonLimitForce: 25,
  FramePosition: 26,
  FrameQuaternion: 27,
  FrameXAxis: 28,
  FrameYAxis: 29,
  FrameZAxis: 30,
  FrameLinearVelocity: 31,
  FrameAngularVelocity: 32,
  FrameLinearAcceleration: 33,
  FrameAngularAcceleration: 34,
  SubtreeCenterOfMass: 35,
  SubtreeLinearVelocity: 36,
  SubtreeAngularMomentum: 37,
  InsideSite: 38,
  GeomDistance: 39,
  GeomNormal: 40,
  GeomFromTo: 41,
  Contact: 42,
  PotentialEnergy: 43,
  KineticEnergy: 44,
  Clock: 45,
  Tactile: 46,
  Plugin: 47,
  User: 48,
} as const;

export type SensorType = (typeof SensorType)[keyof typeof SensorType];

export const SENSOR_TYPE_LABELS: Record<number, string> = {
  [SensorType.Touch]: 'touch',
  [SensorType.Accelerometer]: 'accelerometer',
  [SensorType.Velocimeter]: 'velocimeter',
  [SensorType.Gyro]: 'gyro',
  [SensorType.Force]: 'force',
  [SensorType.Torque]: 'torque',
  [SensorType.Magnetometer]: 'magnetometer',
  [SensorType.Rangefinder]: 'rangefinder',
  [SensorType.CamProjection]: 'camprojection',
  [SensorType.JointPosition]: 'jointpos',
  [SensorType.JointVelocity]: 'jointvel',
  [SensorType.TendonPosition]: 'tendonpos',
  [SensorType.TendonVelocity]: 'tendonvel',
  [SensorType.ActuatorPosition]: 'actuatorpos',
  [SensorType.ActuatorVelocity]: 'actuatorvel',
  [SensorType.ActuatorForce]: 'actuatorfrc',
  [SensorType.JointActuatorForce]: 'jointactuatorfrc',
  [SensorType.TendonActuatorForce]: 'tendonactuatorfrc',
  [SensorType.BallQuaternion]: 'ballquat',
  [SensorType.BallAngularVelocity]: 'ballangvel',
  [SensorType.JointLimitPosition]: 'jointlimitpos',
  [SensorType.JointLimitVelocity]: 'jointlimitvel',
  [SensorType.JointLimitForce]: 'jointlimitfrc',
  [SensorType.TendonLimitPosition]: 'tendonlimitpos',
  [SensorType.TendonLimitVelocity]: 'tendonlimitvel',
  [SensorType.TendonLimitForce]: 'tendonlimitfrc',
  [SensorType.FramePosition]: 'framepos',
  [SensorType.FrameQuaternion]: 'framequat',
  [SensorType.FrameXAxis]: 'framexaxis',
  [SensorType.FrameYAxis]: 'frameyaxis',
  [SensorType.FrameZAxis]: 'framezaxis',
  [SensorType.FrameLinearVelocity]: 'framelinvel',
  [SensorType.FrameAngularVelocity]: 'frameangvel',
  [SensorType.FrameLinearAcceleration]: 'framelinacc',
  [SensorType.FrameAngularAcceleration]: 'frameangacc',
  [SensorType.SubtreeCenterOfMass]: 'subtreecom',
  [SensorType.SubtreeLinearVelocity]: 'subtreelinvel',
  [SensorType.SubtreeAngularMomentum]: 'subtreeangmom',
  [SensorType.InsideSite]: 'insidesite',
  [SensorType.GeomDistance]: 'geomdist',
  [SensorType.GeomNormal]: 'geomnormal',
  [SensorType.GeomFromTo]: 'geomfromto',
  [SensorType.Contact]: 'contact',
  [SensorType.PotentialEnergy]: 'energy',
  [SensorType.KineticEnergy]: 'energy',
  [SensorType.Clock]: 'clock',
  [SensorType.Tactile]: 'tactile',
  [SensorType.Plugin]: 'plugin',
  [SensorType.User]: 'user',
};
