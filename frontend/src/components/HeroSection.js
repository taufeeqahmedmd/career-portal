import "../styles/main.css";
import React, { useState, useEffect } from "react";
import heroDesktop from "../assets/slider-desktop.png";
import heroMobile from "../assets/slider-mobile.png";
import dpsDesktop from "../assets/dps-slider-desktop.png";
import dpsMobile from "../assets/dps-slider-mobile.png";
import pgosDesktop from "../assets/pgos-slider-desktop.png";
import pgosMobile from "../assets/pgos-slider-mobile.png";

// Each entity gets its own hero artwork; / keeps the combined banner
const HERO_IMAGES = {
  DPS: { desktop: dpsDesktop, mobile: dpsMobile },
  Pallavi: { desktop: pgosDesktop, mobile: pgosMobile },
};

// School counts shown in the hero stats - fixed marketing figures
const HERO_SCHOOLS = {
  DPS: "5",
  Pallavi: "45+",
  default: "50+",
};

const HeroSection = ({ onApplyClick, entity }) => {
  const images = (entity && HERO_IMAGES[entity.code]) || {
    desktop: heroDesktop,
    mobile: heroMobile,
  };
  const [bgImage, setBgImage] = useState(images.desktop);

  useEffect(() => {
    const handleResize = () => {
      setBgImage(window.innerWidth < 768 ? images.mobile : images.desktop);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [images.desktop, images.mobile]);

  const schools = (entity && HERO_SCHOOLS[entity.code]) || HERO_SCHOOLS.default;

  return (
    <section id="hero" className="relative bg-[#f6f7f9] pt-20 sm:pt-24 pb-8 sm:pb-12">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-5">
        <div className="relative rounded-[1.5rem] sm:rounded-[2rem] overflow-hidden h-[85vh] min-h-[560px] max-h-[900px]">
          {/* Background image */}
          <img
            src={bgImage}
            alt={entity ? `Life at ${entity.name}` : "Life at Delhi Public Schools and Pallavi Group of Schools"}
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Overlay for text readability */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/30 to-black/10"></div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"></div>

          {/* Overlay text - left aligned */}
          <div className="absolute inset-0 flex items-end sm:items-center pb-28 sm:pb-0">
            <div className="px-6 sm:px-10 lg:px-14 max-w-3xl sm:mt-16">
              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold text-white font-poppins leading-[1.12] mb-4 sm:mb-5">
                Careers That Inspire,
                <br />
                Futures That Endure
              </h1>
              <p className="text-white/90 text-base sm:text-xl leading-relaxed max-w-xl">
                {entity
                  ? `Join ${entity.name} — explore our openings and apply today.`
                  : "Join Delhi Public Schools & Pallavi Group of Schools — explore our openings and apply today."}
              </p>

              {/* Stats Row */}
              <div className="hidden sm:flex items-center gap-8 mt-8">
                <div>
                  <div className="text-3xl font-bold text-white">50+</div>
                  <div className="text-white/70 text-sm">Open Positions</div>
                </div>
                <div className="w-px h-12 bg-white/25"></div>
                <div>
                  <div className="text-3xl font-bold text-white">1500+</div>
                  <div className="text-white/70 text-sm">Happy Teachers</div>
                </div>
                <div className="w-px h-12 bg-white/25"></div>
                <div>
                  <div className="text-3xl font-bold text-white">{schools}</div>
                  <div className="text-white/70 text-sm">Schools</div>
                </div>
              </div>
            </div>
          </div>

          {/* Notched CTA - top right */}
          <div className="absolute top-0 right-0 bg-[#f6f7f9] pb-3 pl-3 rounded-bl-[1.75rem]">
            {/* Concave corners where the notch meets the image */}
            <span
              className="absolute top-0 -left-6 w-6 h-6"
              style={{ background: "radial-gradient(circle at 0 100%, transparent 1.45rem, #f6f7f9 1.5rem)" }}
            ></span>
            <span
              className="absolute -bottom-6 right-0 w-6 h-6"
              style={{ background: "radial-gradient(circle at 0 100%, transparent 1.45rem, #f6f7f9 1.5rem)" }}
            ></span>
            <a
              href="#job-openings"
              className="flex items-center justify-center gap-2 bg-[#a81724] hover:bg-[#8a1420] text-white font-semibold text-sm sm:text-base px-6 sm:px-10 py-3.5 sm:py-4 rounded-full transition-colors shadow-lg"
            >
              Explore Opportunities
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </a>
          </div>

          {/* Notched CTA - bottom left */}
          <div className="absolute bottom-0 left-0 bg-[#f6f7f9] pt-3 pr-3 rounded-tr-[1.75rem]">
            {/* Concave corners where the notch meets the image */}
            <span
              className="absolute -top-6 left-0 w-6 h-6"
              style={{ background: "radial-gradient(circle at 100% 0, transparent 1.45rem, #f6f7f9 1.5rem)" }}
            ></span>
            <span
              className="absolute bottom-0 -right-6 w-6 h-6"
              style={{ background: "radial-gradient(circle at 100% 0, transparent 1.45rem, #f6f7f9 1.5rem)" }}
            ></span>
            <button
              type="button"
              onClick={onApplyClick}
              className="flex items-center justify-center gap-2 bg-[rgb(30,58,138)] hover:bg-[rgb(24,47,110)] text-white font-semibold text-sm sm:text-base px-8 sm:px-14 py-4 sm:py-5 rounded-full transition-colors shadow-lg"
            >
              Apply Now
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
