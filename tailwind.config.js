/** @type {import('tailwindcss').Config} */
// Apenas cores existentes recebem tokens; espaçamentos/layout não são alterados.
const shades = (prefix, steps) => Object.fromEntries(
  steps.map(step => [step, `rgb(var(--ui-${prefix}-${step}) / <alpha-value>)`])
);
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: shades('slate', [50,100,200,300,400,500,600,700,800,900]),
        blue: shades('blue', [50,100,200,300,400,500,600,700,800,900,950]),
        white: 'rgb(var(--ui-surface) / <alpha-value>)',
        'brand-on-accent': 'rgb(var(--ui-on-accent) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
