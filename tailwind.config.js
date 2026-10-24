/** Konfigurasi Tailwind CLI (produksi). Sumber kebenaran tunggal untuk tema warna dan tipografi.
 *  Build:  npm run build:css   ->  assets/css/tailwind.css
 */
module.exports = {
  darkMode: 'class',
  content: ['./*.html', './assets/js/**/*.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'sans-serif'],
        logo: ['Poppins', 'sans-serif'],
      },
      colors: {
        navy: { DEFAULT: '#0F172A', 900: '#070A11', 800: '#0F172A', 700: '#1E293B' },
        accent: { DEFAULT: '#F59E0B', hover: '#D97706', light: '#FEF3C7' },
        ink: '#64748B',
        soft: '#FEF3C7',
        coral: '#EA580C',
        cyan: '#06B6D4',
        emerald: '#10B981',
        good: '#10B981',
        minor: '#F59E0B',
        major: '#EF4444',
      },
      boxShadow: {
        glass: '0 20px 40px -15px rgba(0, 0, 0, 0.08)',
        'glass-dark': '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        glow: '0 0 35px -5px rgba(245, 158, 11, 0.35)',
        'glow-cyan': '0 0 35px -5px rgba(6, 182, 212, 0.35)',
        card: '0 20px 40px -15px rgba(0, 0, 0, 0.08)',
        floating: '0 20px 40px -10px rgba(0,0,0,.1)',
        btn: '0 10px 25px -8px rgba(245, 158, 11, 0.5)',
      },
      animation: { float: 'float 6s ease-in-out infinite' },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
    },
  },
};
