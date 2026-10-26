// assets/js/auth.js

// 1. Inisialisasi Supabase (Satu instance global untuk aplikasi)
const SUPABASE_URL = 'https://dhepuekkghkwczebhjfs.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_t0jPp2JlUJg3KLf6Ed4cCg_WzPbwXhk';

const isSupabaseLoaded = typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function';
if (!isSupabaseLoaded) {
  console.error('Pustaka Supabase belum berhasil dimuat. Periksa koneksi internet atau pemblokir konten (adblock).');
}

window.supabaseDb = isSupabaseLoaded ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;


const mobileMenu = document.getElementById('mobile-menu');
if (mobileMenu) {
  const ul = mobileMenu.querySelector('ul');
  ul.insertAdjacentHTML('beforeend', `
    <li id="mobile-login-li"><button id="btn-login-mobile" class="w-full text-left flex items-center gap-3 rounded-xl px-4 py-3 hover:bg-soft font-bold text-navy"><i data-lucide="log-in" class="h-4 w-4 text-accent"></i>Login / Daftar</button></li>
    <li id="mobile-logout-li" class="hidden"><button id="btn-logout-mobile" class="w-full text-left flex items-center gap-3 rounded-xl px-4 py-3 hover:bg-major/10 font-bold text-major"><i data-lucide="log-out" class="h-4 w-4 text-major"></i>Logout</button></li>
  `);
  if (window.lucide) window.lucide.createIcons();

  const closeMobileMenu = () => {
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle && !mobileMenu.classList.contains('hidden')) menuToggle.click();
    else mobileMenu.classList.add('hidden');
  };

  document.getElementById('btn-login-mobile').addEventListener('click', () => {
    closeMobileMenu();
    window.location.href = 'login.html';
  });

  document.getElementById('btn-logout-mobile').addEventListener('click', async () => {
    closeMobileMenu();
    if (window.supabaseDb) await window.supabaseDb.auth.signOut();
  });
}


function getIndonesianAuthError(msg) {
  if (!msg) return 'Terjadi kesalahan sistem. Silakan coba lagi.';
  const lower = msg.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Email atau password salah.';
  if (lower.includes('email not confirmed')) return 'Email belum diverifikasi. Silakan periksa inbox/spam email Anda.';
  if (lower.includes('user already registered') || lower.includes('already registered')) return 'Email sudah terdaftar. Silakan login atau gunakan email lain.';
  if (lower.includes('password should be at least')) return 'Password minimal harus 6 karakter.';
  if (lower.includes('rate limit')) return 'Terlalu banyak permintaan. Silakan tunggu beberapa saat.';
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network error') || lower.includes('load failed')) {
    if (window.location.protocol === 'file:') {
      return 'Gagal terhubung karena halaman dibuka lewat file:// (CORS diblokir browser). Buka melalui server lokal: jalankan "npx serve ." atau "python3 -m http.server 8080".';
    }
    return 'Gagal terhubung ke server Supabase. Pastikan koneksi internet aktif atau periksa pemblokir iklan (adblocker).';
  }
  return msg;
}


let isRecovery = location.hash.includes('type=recovery') || new URLSearchParams(location.search).get('type') === 'recovery';

// 3. Logic Halaman Login (Hanya berjalan jika elemen form login ada)
const authForm = document.getElementById('auth-form');
if (authForm) {
  const btnSwitchAuth = document.getElementById('btn-switch-auth');
  const btnForgot = document.getElementById('btn-forgot-password');
  const fieldForgot = document.getElementById('field-forgot');
  const fieldNama = document.getElementById('field-nama');
  const inputEmail = document.getElementById('auth-email');
  const fieldEmail = inputEmail ? inputEmail.closest('div') : null;
  const inputPassword = document.getElementById('auth-password');
  const fieldPassword = inputPassword ? inputPassword.closest('div') : null;
  let authMode = 'login'; // 'login' | 'register' | 'forgot' | 'recovery'

  const setAuthMode = (mode) => {
    authMode = mode;
    document.getElementById('auth-error').classList.add('hidden');

    if (authMode === 'login') {
      document.getElementById('auth-title').textContent = 'Login';
      document.getElementById('auth-subtitle').textContent = 'Masuk untuk melaporkan kerusakan jalan';
      if (fieldNama) fieldNama.classList.add('hidden');
      document.getElementById('auth-nama').required = false;
      if (fieldEmail) fieldEmail.classList.remove('hidden');
      if (inputEmail) inputEmail.required = true;
      if (fieldPassword) fieldPassword.classList.remove('hidden');
      if (inputPassword) {
        inputPassword.required = true;
        inputPassword.placeholder = 'Minimal 6 karakter';
      }
      if (fieldForgot) fieldForgot.classList.remove('hidden');
      document.getElementById('btn-submit-auth').textContent = 'Login';
      document.getElementById('auth-switch-text').textContent = 'Belum punya akun?';
      btnSwitchAuth.textContent = 'Daftar sekarang';
      btnSwitchAuth.classList.remove('hidden');
    } else if (authMode === 'register') {
      document.getElementById('auth-title').textContent = 'Daftar Akun';
      document.getElementById('auth-subtitle').textContent = 'Bergabung untuk mulai memantau jalan';
      if (fieldNama) fieldNama.classList.remove('hidden');
      document.getElementById('auth-nama').required = true;
      if (fieldEmail) fieldEmail.classList.remove('hidden');
      if (inputEmail) inputEmail.required = true;
      if (fieldPassword) fieldPassword.classList.remove('hidden');
      if (inputPassword) {
        inputPassword.required = true;
        inputPassword.placeholder = 'Minimal 6 karakter';
      }
      if (fieldForgot) fieldForgot.classList.add('hidden');
      document.getElementById('btn-submit-auth').textContent = 'Daftar';
      document.getElementById('auth-switch-text').textContent = 'Sudah punya akun?';
      btnSwitchAuth.textContent = 'Masuk di sini';
      btnSwitchAuth.classList.remove('hidden');
    } else if (authMode === 'forgot') {
      document.getElementById('auth-title').textContent = 'Lupa Password';
      document.getElementById('auth-subtitle').textContent = 'Masukkan email untuk menerima link pemulihan kata sandi';
      if (fieldNama) fieldNama.classList.add('hidden');
      document.getElementById('auth-nama').required = false;
      if (fieldEmail) fieldEmail.classList.remove('hidden');
      if (inputEmail) inputEmail.required = true;
      if (fieldPassword) fieldPassword.classList.add('hidden');
      if (inputPassword) inputPassword.required = false;
      if (fieldForgot) fieldForgot.classList.add('hidden');
      document.getElementById('btn-submit-auth').textContent = 'Kirim Link Reset';
      document.getElementById('auth-switch-text').textContent = 'Ingat kata sandi?';
      btnSwitchAuth.textContent = 'Kembali ke Login';
      btnSwitchAuth.classList.remove('hidden');
    } else if (authMode === 'recovery') {
      document.getElementById('auth-title').textContent = 'Atur Password Baru';
      document.getElementById('auth-subtitle').textContent = 'Masukkan kata sandi baru untuk akun Anda';
      if (fieldNama) fieldNama.classList.add('hidden');
      document.getElementById('auth-nama').required = false;
      if (fieldEmail) fieldEmail.classList.add('hidden');
      if (inputEmail) inputEmail.required = false;
      if (fieldPassword) fieldPassword.classList.remove('hidden');
      if (inputPassword) {
        inputPassword.required = true;
        inputPassword.value = '';
        inputPassword.placeholder = 'Password baru (min. 6 karakter)';
      }
      if (fieldForgot) fieldForgot.classList.add('hidden');
      document.getElementById('btn-submit-auth').textContent = 'Simpan Password Baru';
      document.getElementById('auth-switch-text').textContent = 'Batal?';
      btnSwitchAuth.textContent = 'Kembali ke Login';
      btnSwitchAuth.classList.remove('hidden');
    }
  };

  btnSwitchAuth.addEventListener('click', async () => {
    if (authMode === 'recovery') {
      await window.supabaseDb.auth.signOut();
      isRecovery = false;
      setAuthMode('login');
    } else if (authMode === 'login') {
      setAuthMode('register');
    } else {
      setAuthMode('login');
    }
  });

  if (btnForgot) {
    btnForgot.addEventListener('click', () => setAuthMode('forgot'));
  }

  if (isRecovery) {
    setAuthMode('recovery');
  }
  window.addEventListener('jk-recovery', () => setAuthMode('recovery'));

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const nama = document.getElementById('auth-nama').value.trim();
    const btn = document.getElementById('btn-submit-auth');
    const errorEl = document.getElementById('auth-error');

    btn.disabled = true;
    errorEl.classList.add('hidden');
    errorEl.classList.remove('text-good', 'bg-good/10', 'text-major', 'bg-major/10');

    if (!window.supabaseDb) {
      errorEl.textContent = 'Pustaka Supabase belum termuat. Periksa koneksi internet atau pemblokir iklan (adblocker), lalu muat ulang halaman.';
      errorEl.classList.remove('hidden');
      errorEl.classList.add('text-major', 'bg-major/10');
      btn.disabled = false;
      return;
    }

    try {
      if (authMode === 'login') {
        const { error } = await window.supabaseDb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = 'app.html#lapor';
      } else if (authMode === 'register') {
        const { data, error } = await window.supabaseDb.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: nama },
            emailRedirectTo: window.location.origin + window.location.pathname
          }
        });
        if (error) throw error;

        // Deteksi jika user sudah terdaftar tapi Supabase mengembalikan user palsu ber-identitas kosong
        if (data?.user && (!data.user.identities || data.user.identities.length === 0)) {
          throw new Error('User already registered');
        }

        if (data?.session) {
          window.location.href = 'app.html#lapor';
        } else {
          errorEl.textContent = 'Pendaftaran berhasil! Silakan periksa email Anda untuk verifikasi.';
          errorEl.classList.remove('hidden');
          errorEl.classList.add('text-good', 'bg-good/10');
        }
      } else if (authMode === 'forgot') {
        const { error } = await window.supabaseDb.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname
        });
        if (error) throw error;
        errorEl.textContent = 'Link pemulihan kata sandi telah dikirim ke email Anda! Silakan periksa inbox atau spam.';
        errorEl.classList.remove('hidden');
        errorEl.classList.add('text-good', 'bg-good/10');
      } else if (authMode === 'recovery') {
        const { error } = await window.supabaseDb.auth.updateUser({ password });
        if (error) throw error;
        await window.supabaseDb.auth.signOut();
        isRecovery = false;
        setAuthMode('login');
        errorEl.textContent = 'Password berhasil diperbarui! Silakan login dengan kata sandi baru Anda.';
        errorEl.className = 'text-sm text-good bg-good/10 p-4 rounded-xl font-bold text-center';
        errorEl.classList.remove('hidden');
      }
    } catch (err) {
      errorEl.textContent = getIndonesianAuthError(err.message);
      errorEl.classList.remove('hidden');
      errorEl.classList.add('text-major', 'bg-major/10');
    } finally {
      btn.disabled = false;
    }
  });
}

// 4. Setup event Navbar Desktop
const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
  btnLogout.addEventListener('click', async () => {
    await window.supabaseDb.auth.signOut();
  });
}

const btnLoginNav = document.getElementById('btn-login-nav');
if (btnLoginNav) {
  btnLoginNav.addEventListener('click', () => {
    window.location.href = 'login.html';
  });
}

// Cache pengecekan hak akses admin per user ID agar tidak query berulang
let adminCheckedFor = null;
async function syncAdminLinks(currentUser) {
  if (!currentUser) {
    adminCheckedFor = null;
    const adminLink = document.getElementById('btn-admin-nav');
    if (adminLink) adminLink.remove();
    const mobAdmin = document.getElementById('mobile-admin-li');
    if (mobAdmin) mobAdmin.remove();
    return;
  }

  if (adminCheckedFor === currentUser.id) return;
  adminCheckedFor = currentUser.id;

  try {
    const { data } = await window.supabaseDb.from('admins').select('user_id').eq('user_id', currentUser.id).maybeSingle();
    const isAdmin = !!(data && data.user_id);

    // Desktop Navbar Admin Link
    const navUserMenu = document.getElementById('user-menu');
    let adminLink = document.getElementById('btn-admin-nav');
    if (isAdmin && navUserMenu) {
      if (!adminLink) {
        adminLink = document.createElement('a');
        adminLink.id = 'btn-admin-nav';
        adminLink.href = 'admin.html';
        adminLink.className = 'rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white transition hover:bg-navy/80 flex items-center gap-1 shadow-sm';
        adminLink.innerHTML = '<i data-lucide="shield" class="h-3.5 w-3.5 text-accent"></i> Admin';
        navUserMenu.prepend(adminLink);
      }
    } else if (adminLink) {
      adminLink.remove();
    }

    // Mobile Menu Admin Link
    let mobAdmin = document.getElementById('mobile-admin-li');
    if (isAdmin && mobileMenu) {
      if (!mobAdmin) {
        const ul = mobileMenu.querySelector('ul');
        if (ul) {
          ul.insertAdjacentHTML('afterbegin', `
            <li id="mobile-admin-li"><a href="admin.html" class="w-full text-left flex items-center gap-3 rounded-xl px-4 py-3 hover:bg-slate-100 font-bold text-navy"><i data-lucide="shield" class="h-4 w-4 text-accent"></i>Dashboard Admin</a></li>
          `);
        }
      }
    } else if (mobAdmin) {
      mobAdmin.remove();
    }

    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    adminCheckedFor = null; // izinkan coba ulang jika terjadi kegagalan jaringan
    console.warn('Gagal memeriksa status admin:', e);
  }
}

// 5. Auth State Listener & Form Lapor Logic (Hanya berjalan di halaman yang memiliki navbar/form)
if (window.supabaseDb) {
  window.supabaseDb.auth.onAuthStateChange((event, session) => {
    const user = session?.user;

    if (event === 'PASSWORD_RECOVERY') {
      isRecovery = true;
      window.dispatchEvent(new Event('jk-recovery'));
    }

    // Dukung deteksi halaman login dengan clean URL (/login) atau file langsung (login.html)
    const isLoginPage = /(^|\/)(login(\.html)?|\blogin\b)($|\?|#)/i.test(window.location.pathname);
    if (user && isLoginPage && !isRecovery) {
      window.location.href = 'app.html#lapor';
    }

    // Update Navbar Desktop UI
    const userMenu = document.getElementById('user-menu');
    const userNameDisplay = document.getElementById('user-initial');

    if (user) {
      if (btnLoginNav) btnLoginNav.classList.add('hidden');
      if (userMenu) {
        userMenu.classList.remove('hidden');
        userMenu.classList.add('flex');

        // Tampilkan tombol "Laporan Saya" untuk pelapor login
        let myReportsBtn = document.getElementById('btn-my-reports-nav');
        if (!myReportsBtn) {
          myReportsBtn = document.createElement('button');
          myReportsBtn.id = 'btn-my-reports-nav';
          myReportsBtn.type = 'button';
          myReportsBtn.className = 'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-navy hover:bg-slate-50 transition flex items-center gap-1.5 shadow-sm';
          myReportsBtn.innerHTML = '<i data-lucide="clipboard-list" class="h-3.5 w-3.5 text-accent"></i> Laporan Saya';
          myReportsBtn.addEventListener('click', () => {
            if (window.location.pathname.includes('app.html') || window.location.pathname.endsWith('/app')) {
              window.dispatchEvent(new Event('jk-open-my-reports'));
            } else {
              window.location.href = 'app.html#laporan-saya';
            }
          });
          userMenu.prepend(myReportsBtn);
          if (window.lucide) window.lucide.createIcons();
        }
      }
      if (userNameDisplay) {
        const fullName = user.user_metadata?.full_name || user.email;
        userNameDisplay.textContent = fullName.charAt(0).toUpperCase();
        userNameDisplay.title = fullName;
      }

      // Mobile Menu UI
      const mobLogin = document.getElementById('mobile-login-li');
      const mobLogout = document.getElementById('mobile-logout-li');
      if (mobLogin) mobLogin.classList.add('hidden');
      if (mobLogout) mobLogout.classList.remove('hidden');

      let mobMyReports = document.getElementById('mobile-my-reports-li');
      if (!mobMyReports && mobileMenu) {
        const ul = mobileMenu.querySelector('ul');
        if (ul) {
          ul.insertAdjacentHTML('afterbegin', `
          <li id="mobile-my-reports-li"><button id="btn-my-reports-mob" class="w-full text-left flex items-center gap-3 rounded-xl px-4 py-3 hover:bg-slate-100 font-bold text-navy"><i data-lucide="clipboard-list" class="h-4 w-4 text-accent"></i>Laporan Saya</button></li>
        `);
          document.getElementById('btn-my-reports-mob')?.addEventListener('click', () => {
            const menuToggle = document.getElementById('menu-toggle');
            if (menuToggle && !mobileMenu.classList.contains('hidden')) menuToggle.click();
            else mobileMenu.classList.add('hidden');

            if (window.location.pathname.includes('app.html') || window.location.pathname.endsWith('/app')) {
              window.dispatchEvent(new Event('jk-open-my-reports'));
            } else {
              window.location.href = 'app.html#laporan-saya';
            }
          });
          if (window.lucide) window.lucide.createIcons();
        }
      }

      // Sinkronisasi link admin (sekali query dengan cache)
      setTimeout(() => syncAdminLinks(user), 0);

    } else {
      if (btnLoginNav) btnLoginNav.classList.remove('hidden');
      if (userMenu) {
        userMenu.classList.add('hidden');
        userMenu.classList.remove('flex');
      }

      const myReportsBtn = document.getElementById('btn-my-reports-nav');
      if (myReportsBtn) myReportsBtn.remove();

      // Mobile Menu UI
      const mobLogin = document.getElementById('mobile-login-li');
      const mobLogout = document.getElementById('mobile-logout-li');
      if (mobLogin) mobLogin.classList.remove('hidden');
      if (mobLogout) mobLogout.classList.add('hidden');

      const mobMyReports = document.getElementById('mobile-my-reports-li');
      if (mobMyReports) mobMyReports.remove();

      setTimeout(() => syncAdminLinks(null), 0);
    }

    // Automasi Lapor Form (#report-form) di app.html
    const reportForm = document.getElementById('report-form');
    const inputNama = document.getElementById('input-nama');
    const btnSubmitReport = document.getElementById('btn-submit-report');

    if (reportForm && inputNama && btnSubmitReport) {
      // Input dan textarea yang dikontrol auth state.
      // Kecualikan #btn-geolocate dan #btn-foto-remove agar tidak tertimpa saat TOKEN_REFRESHED / proses geolokasi GPS berjalan
      const formFields = reportForm.querySelectorAll('input:not(#input-nama):not(#input-lat):not(#input-lng), textarea');
      const btnGeo = document.getElementById('btn-geolocate');
      const dropzone = document.getElementById('dropzone');

      if (user) {
        // Pastikan disabled = false ketika user login, lalu set readonly
        inputNama.disabled = false;
        inputNama.value = user.user_metadata?.full_name || user.email;
        inputNama.readOnly = true;
        inputNama.classList.add('opacity-70', 'cursor-not-allowed', 'pointer-events-none');

        const isSubmitting = Boolean(window.__isSubmittingReport || reportForm.dataset?.submitting === 'true');

        // Jangan aktifkan tombol jika sedang dalam proses pengiriman laporan
        if (!isSubmitting) {
          btnSubmitReport.disabled = false;
          formFields.forEach(el => el.disabled = false);

          // Aktifkan kembali tombol geolocate hanya jika tidak sedang aktif mencari GPS
          if (btnGeo && !btnGeo.querySelector('span')?.textContent?.includes('Mencari')) {
            btnGeo.disabled = false;
          }

          if (dropzone) dropzone.classList.remove('opacity-50', 'pointer-events-none');
        }

        const prevWarning = document.getElementById('auth-warning-form');
        if (prevWarning) prevWarning.remove();
      } else {
        inputNama.value = '';
        inputNama.readOnly = false;
        inputNama.classList.remove('opacity-70', 'cursor-not-allowed', 'pointer-events-none');
        inputNama.disabled = true; // Kunci input nama karena belum login
        btnSubmitReport.disabled = true;

        // Disable form input lainnya
        formFields.forEach(el => el.disabled = true);
        if (btnGeo) btnGeo.disabled = true;
        if (dropzone) dropzone.classList.add('opacity-50', 'pointer-events-none');

        let warning = document.getElementById('auth-warning-form');
        if (!warning) {
          warning = document.createElement('div');
          warning.id = 'auth-warning-form';
          warning.innerHTML = `
            <span><i data-lucide="lock" class="h-4 w-4 inline mr-2"></i>Silakan login terlebih dahulu untuk membuat laporan jalan rusak.</span>
            <a href="login.html" class="shrink-0 rounded-lg bg-major px-4 py-2 text-center text-xs font-bold text-white shadow hover:bg-major/90 transition w-full sm:w-auto">Login</a>
          `;
          reportForm.prepend(warning);
          if (window.lucide) window.lucide.createIcons();
        }
      }
    }
  });
}


