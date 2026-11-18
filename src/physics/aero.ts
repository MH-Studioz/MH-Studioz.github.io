import { CAR_CLASSES, type AeroPackage, type CarClass } from '../garage/carConfig';

export interface AeroSetup {
  aeroPackage: AeroPackage;
  carClass: CarClass;
  frontWingAngle: number; // 0..20 deg
  rearWingAngle: number; // 0..25 deg
  rideHeight: number; // 30..80 mm
}

export interface AeroState {
  cla: number;
  cda: number;
  drag: number;
  downforce: number;
  drsEffect: number;
}

const PACKAGES: Record<AeroPackage, { cla: number; cda: number }> = {
  'low-drag': { cla: 2.55, cda: 0.9 },
  balanced: { cla: 3.5, cda: 1.06 },
  'high-downforce': { cla: 4.6, cda: 1.24 },
};

export function computeAero(
  setup: AeroSetup,
  speed: number,
  drsOpen: boolean,
  dirtyAir: number,
  floorDamage: number,
  wingDamage: number,
  out?: AeroState,
): AeroState {
  const pkg = PACKAGES[setup.aeroPackage] ?? PACKAGES.balanced;
  const classSpec = CAR_CLASSES[setup.carClass] ?? CAR_CLASSES.hybrid;
  const front = Math.max(0, Math.min(20, setup.frontWingAngle));
  const rear = Math.max(0, Math.min(25, setup.rearWingAngle));
  const ride = Math.max(30, Math.min(80, setup.rideHeight));
  const wingAuthority =
    classSpec.id === 'hypercar'
      ? 0.5
      : classSpec.id === 'stock'
        ? 0.3
        : classSpec.category === 'open-wheel'
          ? 1
          : classSpec.category === 'prototype'
            ? 0.58
            : classSpec.category === 'gt'
              ? 0.42
              : 0.06;
  let cla =
    pkg.cla *
    classSpec.aero *
    (0.72 + front * 0.0135 * wingAuthority + rear * 0.0125 * wingAuthority) *
    (1.03 - (ride - 30) * 0.00075);
  let cda =
    pkg.cda * classSpec.drag * (0.78 + front * 0.006 * wingAuthority + rear * 0.0072 * wingAuthority) +
    (ride - 30) * 0.0008;

  // Floor damage costs downforce and adds turbulence drag.
  cla *= 1 - Math.min(0.42, floorDamage * 0.42);
  cda += floorDamage * 0.16;
  // A missing endplate hurts balance more than raw drag.
  cla *= 1 - wingDamage * 0.1;
  cda += wingDamage * 0.035;

  // DRS: rear flap opens 65 degrees, cutting drag and rear downforce.
  let drsEffect = 0;
  if (drsOpen) {
    drsEffect = 1;
    cla *= 0.72;
    cda *= 0.76;
  }

  // Dirty air within one second: up to 22% downforce loss.
  cla *= 1 - Math.max(0, Math.min(1, dirtyAir)) * 0.22;

  const q = 0.5 * 1.225 * speed * speed;
  if (out) {
    out.cla = cla;
    out.cda = cda;
    out.drag = q * cda;
    out.downforce = q * cla;
    out.drsEffect = drsEffect;
    return out;
  }
  return { cla, cda, drag: q * cda, downforce: q * cla, drsEffect };
}
