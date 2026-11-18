import {
  continueAsGuest,
  createDriver,
  currentAccount,
  hasRegisteredDrivers,
  signInDriver,
  signOut,
  type DriverAccount,
} from '../account/account';

type Mode = 'signin' | 'create';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing account element #${id}`);
  return el as T;
}

function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

export class AccountUI {
  onAccountChange: ((account: DriverAccount | null) => void) | null = null;

  private modal = byId('modal-account');
  private name = byId<HTMLInputElement>('account-name');
  private password = byId<HTMLInputElement>('account-password');
  private submit = byId<HTMLButtonElement>('account-submit');
  private message = byId('account-message');
  private signedIn = byId('account-signed-in');
  private forms = byId('account-forms');
  private tabSignIn = byId<HTMLButtonElement>('account-tab-signin');
  private tabCreate = byId<HTMLButtonElement>('account-tab-create');
  private mode: Mode = 'signin';
  private after: (() => void) | null = null;

  constructor() {
    this.tabSignIn.addEventListener('click', () => this.setMode('signin'));
    this.tabCreate.addEventListener('click', () => this.setMode('create'));
    this.submit.addEventListener('click', () => void this.handleSubmit());
    this.password.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void this.handleSubmit();
    });
    byId('account-guest').addEventListener('click', () => {
      const account = continueAsGuest();
      this.finish(account);
    });
    byId('account-close').addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (event) => {
      if (event.target === this.modal) {
        this.close();
        return;
      }
      const target = event.target as HTMLElement;
      if (target.closest('#account-signout')) {
        signOut();
        this.onAccountChange?.(null);
        this.render();
        this.setMode('signin');
        this.showMessage('Signed out. You can continue as a guest or sign back in.', false);
      }
    });
    this.render();
  }

  open(after?: () => void): void {
    this.after = after ?? null;
    this.modal.classList.remove('hidden');
    this.setMode(currentAccount() || hasRegisteredDrivers() ? 'signin' : 'create');
    this.render();
    window.setTimeout(() => this.name.focus(), 30);
  }

  close(): void {
    this.modal.classList.add('hidden');
    this.after = null;
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.tabSignIn.classList.toggle('active', mode === 'signin');
    this.tabCreate.classList.toggle('active', mode === 'create');
    this.submit.textContent = mode === 'signin' ? 'SIGN IN' : 'CREATE DRIVER';
    this.message.textContent = '';
    this.message.classList.remove('error');
  }

  private async handleSubmit(): Promise<void> {
    const name = this.name.value.trim();
    const password = this.password.value;
    this.submit.disabled = true;
    try {
      const account = this.mode === 'create' ? await createDriver(name, password) : await signInDriver(name, password);
      this.finish(account);
    } catch (error) {
      this.showMessage(error instanceof Error ? error.message : 'Could not sign in.', true);
    } finally {
      this.submit.disabled = false;
    }
  }

  private finish(account: DriverAccount): void {
    this.onAccountChange?.(account);
    this.password.value = '';
    this.render();
    const after = this.after;
    this.after = null;
    this.close();
    after?.();
  }

  private render(): void {
    const account = currentAccount();
    if (account) {
      this.signedIn.classList.remove('hidden');
      this.forms.classList.add('hidden');
      this.signedIn.innerHTML = `
        <span class="eyebrow">${account.guest ? 'GUEST SESSION' : 'DRIVER PROFILE'}</span>
        <strong>${escapeText(account.name)}</strong>
        <small>${account.guest ? 'Temporary identity for this browser.' : 'Signed in on this device.'}</small>
        <button id="account-signout" class="btn-ghost small" type="button">SIGN OUT</button>
      `;
    } else {
      this.signedIn.classList.add('hidden');
      this.forms.classList.remove('hidden');
      this.name.value = '';
    }
  }

  private showMessage(text: string, error: boolean): void {
    this.message.textContent = text;
    this.message.classList.toggle('error', error);
  }
}
