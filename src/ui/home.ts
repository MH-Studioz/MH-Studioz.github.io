import { CAR_CLASSES, type CarConfig } from '../garage/carConfig';
import type { DriverAccount } from '../account/account';

export type HomeAction = 'race' | 'car' | 'timetrial' | 'multiplayer';

export interface HomeCallbacks {
  onAction: (action: HomeAction) => void;
  onAccount: () => void;
  onEditCar: () => void;
}

const CLASS_TOP_SPEED: Record<CarConfig['carClass'], number> = {
  hybrid: 341,
  v10: 350,
  junior: 289,
  gt: 305,
  prototype: 330,
  hypercar: 352,
  stock: 310,
  rally: 205,
  kart: 115,
};

function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function colorName(hex: string): string {
  const value = hex.toLowerCase();
  if (value === '#070b12' || value === '#000000' || value === '#05070b') return 'BLACK';
  if (value === '#2f7dff' || value === '#1b4fa0' || value === '#0a3d91') return 'BLUE';
  if (value === '#ffffff' || value === '#f2f4f7') return 'WHITE';
  return value.toUpperCase();
}

export class HomeUI {
  private callbacks: HomeCallbacks;
  private accountButton = document.getElementById('account-button') as HTMLButtonElement | null;
  private carName = document.getElementById('home-car-name');
  private carTeam = document.getElementById('home-car-team');
  private carClass = document.getElementById('home-car-class');
  private carLivery = document.getElementById('home-car-livery');
  private carSpeed = document.getElementById('home-car-speed');

  constructor(callbacks: HomeCallbacks) {
    this.callbacks = callbacks;
    document.querySelectorAll<HTMLButtonElement>('[data-home-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.homeAction as HomeAction;
        if (action) this.callbacks.onAction(action);
      });
    });
    this.accountButton?.addEventListener('click', () => this.callbacks.onAccount());
    document.getElementById('home-car-edit')?.addEventListener('click', () => this.callbacks.onEditCar());
  }

  refresh(config: CarConfig): void {
    const carClass = CAR_CLASSES[config.carClass];
    if (this.carName) this.carName.textContent = config.driverName.toUpperCase();
    if (this.carTeam) this.carTeam.textContent = `${config.teamName.toUpperCase()} · ${config.livery.tag}`;
    if (this.carClass) this.carClass.textContent = carClass.label.toUpperCase();
    if (this.carLivery) {
      this.carLivery.textContent = `${colorName(config.livery.primary)} / ${colorName(config.livery.secondary)}`;
    }
    if (this.carSpeed) this.carSpeed.textContent = `${CLASS_TOP_SPEED[config.carClass]} KM/H`;
    document.documentElement.style.setProperty('--active-primary', config.livery.primary);
    document.documentElement.style.setProperty('--active-accent', config.livery.accent);
  }

  setAccount(account: DriverAccount | null): void {
    if (!this.accountButton) return;
    if (!account) {
      this.accountButton.textContent = 'SIGN IN';
      this.accountButton.classList.remove('signed-in');
      return;
    }
    this.accountButton.classList.add('signed-in');
    this.accountButton.innerHTML = `<span class="account-dot"></span><span>${escapeText(account.name)}</span>${account.guest ? '<small>GUEST</small>' : ''}`;
  }
}
