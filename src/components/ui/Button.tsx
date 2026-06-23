import { ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}

const variantClasses = {
  primary:   'bg-gold text-void hover:bg-gold-bright border-transparent font-semibold',
  secondary: 'bg-transparent text-parchment hover:bg-panel border-wire',
  danger:    'bg-danger/10 text-danger hover:bg-danger/20 border-danger/30',
  ghost:     'bg-transparent text-warm hover:bg-panel hover:text-parchment border-transparent',
}

const sizeClasses = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={`
          inline-flex items-center justify-center gap-2 font-medium rounded-lg border
          transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-ring focus-visible:ring-offset-2 focus-visible:ring-offset-void
          disabled:opacity-50 disabled:cursor-not-allowed
          ${variantClasses[variant]} ${sizeClasses[size]} ${className}
        `}
        {...props}
      >
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
export default Button
