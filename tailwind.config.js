/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./templates/**/*.html",
    "./static/js/**/*.js"
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "primary-container": "#1a73e8",
        "on-primary": "#ffffff",
        "tertiary-fixed": "#89fa9b",
        "primary": "#005bbf",
        "outline": "#727785",
        "background": "#f7f9ff",
        "surface-tint": "#005bc0",
        "secondary": "#005ac1",
        "tertiary-container": "#008939",
        "primary-fixed-dim": "#adc7ff",
        "secondary-container": "#4d8efe",
        "surface-container-highest": "#dfe3e8",
        "on-tertiary-fixed": "#002108",
        "surface-container-lowest": "#ffffff",
        "secondary-fixed": "#d8e2ff",
        "on-error-container": "#93000a",
        "on-tertiary-fixed-variant": "#005320",
        "primary-fixed": "#d8e2ff",
        "on-tertiary-container": "#ffffff",
        "surface-container-high": "#e5e8ee",
        "secondary-fixed-dim": "#adc6ff",
        "surface-container": "#ebeef4",
        "error-container": "#ffdad6",
        "on-error": "#ffffff",
        "on-secondary": "#ffffff",
        "on-background": "#181c20",
        "surface-bright": "#f7f9ff",
        "outline-variant": "#c1c6d6",
        "error": "#ba1a1a",
        "on-tertiary": "#ffffff",
        "on-secondary-container": "#00285c",
        "inverse-surface": "#2d3135",
        "on-primary-fixed": "#001a41",
        "on-primary-fixed-variant": "#004493",
        "surface-dim": "#d7dae0",
        "tertiary-fixed-dim": "#6ddd81",
        "inverse-primary": "#adc7ff",
        "tertiary": "#006d2c",
        "surface-container-low": "#f1f4fa",
        "surface": "#f7f9ff",
        "inverse-on-surface": "#eef1f7",
        "on-primary-container": "#ffffff",
        "on-secondary-fixed": "#001a41",
        "on-surface": "#181c20",
        "on-surface-variant": "#414754",
        "surface-variant": "#dfe3e8",
        "on-secondary-fixed-variant": "#004494"
      },
      borderRadius: {
        "DEFAULT": "0.25rem",
        "lg": "0.5rem",
        "xl": "0.75rem",
        "full": "9999px"
      },
      spacing: {
        "md": "24px",
        "lg": "32px",
        "margin-mobile": "16px",
        "base": "4px",
        "sm": "16px",
        "xl": "48px",
        "margin-desktop": "64px",
        "xs": "8px",
        "gutter": "24px"
      },
      fontFamily: {
        "title-md": ["Work Sans"],
        "body-md": ["Inter"],
        "headline-lg": ["Work Sans"],
        "headline-xl": ["Work Sans"],
        "body-lg": ["Inter"],
        "label-md": ["JetBrains Mono"],
        "headline-lg-mobile": ["Work Sans"]
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries')
  ]
};
