interface MalibuLogoProps {
  size?: 'sm' | 'lg'
}

export default function MalibuLogo({ size = 'sm' }: MalibuLogoProps) {
  const isLg = size === 'lg'

  return (
    <div className={`relative inline-block ${isLg ? 'pr-7 pt-3' : 'pr-5 pt-2'}`}>
      {/* Gold bracket — reversed-L at upper-right corner */}
      <svg
        className="absolute top-0 right-0"
        width={isLg ? 26 : 17}
        height={isLg ? 22 : 14}
        viewBox="0 0 26 22"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M 2 2 L 24 2 L 24 20"
          stroke="#C9A227"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <div className="flex flex-col" style={{ gap: isLg ? '4px' : '2px' }}>
        <span
          className={`font-display font-bold text-parchment leading-none ${isLg ? 'text-[30px] tracking-[0.22em]' : 'text-[16px] tracking-[0.2em]'}`}
        >
          MALIBU
        </span>
        <span
          className={`font-display font-semibold text-gold leading-none ${isLg ? 'text-[10px] tracking-[0.22em]' : 'text-[7px] tracking-[0.18em]'}`}
        >
          MOVING SPECIALISTS
        </span>
      </div>
    </div>
  )
}
