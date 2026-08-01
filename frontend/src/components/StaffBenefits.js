import React from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { EffectCards, Autoplay } from "swiper/modules";
import "swiper/css/effect-cards";
import staffImage from "../assets/staff-benefits.jpg";
import imgTransport from "../assets/teacher-benefits/transport.png";
import imgTransportDps from "../assets/teacher-benefits/dps-transport.jpeg";
import imgTransportPgos from "../assets/teacher-benefits/pgos-transport.png";
import imgStay from "../assets/teacher-benefits/free-accommodation.webp";
import imgHealth from "../assets/teacher-benefits/cl-1.webp";
import imgTraining from "../assets/teacher-benefits/seminar.webp";

const BENEFITS = [
  {
    image: staffImage,
    title: "Concession in Child Fee",
    sub: "As per policy, for your children studying with us",
  },
  {
    image: imgTransport,
    title: "Transport Facility",
    sub: "For a convenient daily commute",
  },
  {
    image: imgStay,
    title: "Free Accommodation",
    sub: "For outstation candidates",
  },
  {
    image: imgHealth,
    title: "Health Insurance",
    sub: "Coverage for teachers and dependents",
  },
  {
    image: imgTraining,
    title: "Training & Professional Development",
    sub: "Regular programs to grow your skills and career",
  },
];

const BenefitCard = ({ image, title, sub, className = "", delay = 0 }) => (
  <div
    className={`group relative rounded-[1.75rem] overflow-hidden shadow-lg shadow-gray-300/40 ${className}`}
    data-aos="fade-up"
    data-aos-delay={delay}
  >
    <img
      src={image}
      alt={title}
      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
    />
    {/* Scrim for label readability */}
    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent"></div>

    {/* Label */}
    <div className="absolute bottom-0 inset-x-0 p-5 sm:p-6">
      <p className="text-white font-semibold text-base sm:text-lg font-poppins underline underline-offset-[6px] decoration-2 decoration-white/60 group-hover:decoration-amber-400 transition-colors">
        {title}
      </p>
      <p className="text-white/75 text-xs sm:text-sm mt-1.5">{sub}</p>
    </div>
  </div>
);

const Header = () => (
  <div data-aos="fade-up">
    <div className="flex items-center gap-3 mb-4">
      <div className="w-10 h-[2px] bg-[#a81724]"></div>
      <span className="text-[#a81724] text-sm font-semibold tracking-widest uppercase">Why Join Us</span>
    </div>
    <h2 className="text-3xl sm:text-4xl lg:text-[2.6rem] font-bold text-[rgb(30,58,138)] font-poppins leading-[1.15] mb-4">
      Staff Benefits That Put You First
    </h2>
    <p className="text-gray-500 text-sm sm:text-base leading-relaxed">
      We invest in our teachers professionally, personally, and emotionally —
      creating an environment where you can thrive and grow.
    </p>
  </div>
);

// The transport photo is entity-specific on /dps and /pgos
const TRANSPORT_IMAGES = { DPS: imgTransportDps, Pallavi: imgTransportPgos };

const StaffBenefits = ({ entity }) => {
  const transportImg = (entity && TRANSPORT_IMAGES[entity.code]) || imgTransport;
  const benefits = BENEFITS.map((b) =>
    b.title === "Transport Facility" ? { ...b, image: transportImg } : b
  );
  return (
    <section className="relative py-14 sm:py-20 overflow-hidden" id="staff-benefits">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-amber-50/30"></div>
      <div className="absolute top-0 left-0 w-96 h-96 bg-[rgb(30,58,138)]/5 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-amber-400/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2"></div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">

        {/* ---------- Mobile: stacked card deck ---------- */}
        <div className="md:hidden">
          <Header />

          <div className="mt-8" data-aos="fade-up">
            <Swiper
              modules={[EffectCards, Autoplay]}
              effect="cards"
              grabCursor
              loop
              autoplay={{ delay: 3200, disableOnInteraction: false, pauseOnMouseEnter: true }}
              cardsEffect={{ perSlideOffset: 9, perSlideRotate: 2.5, slideShadows: false }}
              className="benefit-deck w-[85%] max-w-[330px]"
            >
              {benefits.map((b, idx) => (
                <SwiperSlide
                  key={b.title}
                  className="rounded-[1.75rem] overflow-hidden bg-gray-200 shadow-xl shadow-gray-400/30"
                >
                  <div className="relative aspect-[4/5]">
                    <img
                      src={b.image}
                      alt={b.title}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-black/10"></div>

                    {/* Frosted badge - top left */}
                    <span className="absolute top-4 left-4 inline-flex items-center gap-1.5 bg-white/20 backdrop-blur-md border border-white/20 rounded-full px-3 py-1.5 text-white text-xs font-semibold">
                      <span className="text-amber-400 text-[10px]">✦</span>
                      Staff Benefit
                    </span>

                    {/* Bottom content */}
                    <div className="absolute bottom-0 inset-x-0 p-5">
                      <p
                        className="text-white text-[1.7rem] leading-[1.15] italic font-semibold mb-3"
                        style={{ fontFamily: "'Fraunces', serif" }}
                      >
                        {b.title}
                      </p>
                      <p className="text-white/75 text-xs font-medium tracking-wide">
                        {String(idx + 1).padStart(2, "0")} / {String(benefits.length).padStart(2, "0")}
                        <span className="mx-1.5 text-amber-400">•</span>
                        {b.sub}
                      </p>
                    </div>
                  </div>
                </SwiperSlide>
              ))}
            </Swiper>
            <p className="text-center text-gray-400 text-xs mt-4 tracking-wide">
              Swipe to explore all {benefits.length} benefits
            </p>
          </div>
        </div>

        {/* ---------- Desktop: portfolio grid ---------- */}
        <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">

          {/* Column 1: header + tall card */}
          <div className="flex flex-col gap-5 sm:gap-6">
            <Header />
            <BenefitCard
              image={benefits[0].image}
              title={benefits[0].title}
              sub={benefits[0].sub}
              className="flex-1 min-h-[300px] sm:min-h-[340px]"
              delay={0}
            />
          </div>

          {/* Column 2: two stacked cards */}
          <div className="flex flex-col gap-5 sm:gap-6">
            <BenefitCard
              image={benefits[1].image}
              title={benefits[1].title}
              sub={benefits[1].sub}
              className="h-[260px] sm:h-[300px]"
              delay={100}
            />
            <BenefitCard
              image={benefits[2].image}
              title={benefits[2].title}
              sub={benefits[2].sub}
              className="flex-1 min-h-[260px] sm:min-h-[300px]"
              delay={200}
            />
          </div>

          {/* Column 3: card + card + pill CTA */}
          <div className="flex flex-col gap-5 sm:gap-6 md:col-span-2 lg:col-span-1 md:grid md:grid-cols-2 lg:flex md:gap-5">
            <BenefitCard
              image={benefits[3].image}
              title={benefits[3].title}
              sub={benefits[3].sub}
              className="h-[260px] sm:h-[280px]"
              delay={150}
            />
            <div className="flex flex-col gap-5 sm:gap-6 flex-1">
              <BenefitCard
                image={benefits[4].image}
                title={benefits[4].title}
                sub={benefits[4].sub}
                className="flex-1 min-h-[220px] sm:min-h-[240px]"
                delay={250}
              />
              <a
                href="#job-openings"
                data-aos="fade-up"
                data-aos-delay={300}
                className="flex items-center justify-center gap-2 border-2 border-[rgb(30,58,138)]/25 hover:border-[rgb(30,58,138)] text-[rgb(30,58,138)] font-semibold px-8 py-4 rounded-full transition-colors bg-white/70 backdrop-blur-sm group"
              >
                Explore Opportunities
                <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default StaffBenefits;
