import { ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}

const variantClasses = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 border-transparent',
  secondary: 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300',
  danger: 'bg-red-600 text-white hover:bg-red-700 border-transparent',
  ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 border-transparent',
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
          transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
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
