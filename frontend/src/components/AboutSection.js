import React from "react";
import {
  FaAward,
  FaSchool,
  FaChalkboardTeacher,
  FaQuoteLeft,
  FaStar,
  FaLightbulb,
  FaShieldAlt,
  FaHeart,
  FaSeedling,
} from "react-icons/fa";
import aboutImg from "../assets/about-card.webp";
import aboutImgDps from "../assets/dps-about.jpg";
import aboutImg2 from "../assets/bg-vision.jpg";
import CountUp from "react-countup";

const AboutSection = ({ entity }) => {
  // On /dps and /pgos the copy talks only about that entity
  const ownerName = entity
    ? entity.name
    : "Delhi Public Schools and the Pallavi Group of Schools";

  // /dps gets its own campus photo; /pgos and / keep the default
  const mainImg = entity?.code === "DPS" ? aboutImgDps : aboutImg;

  const values = [
    { label: "Excellence", icon: <FaStar /> },
    { label: "Innovation", icon: <FaLightbulb /> },
    { label: "Integrity", icon: <FaShieldAlt /> },
    { label: "Compassion", icon: <FaHeart /> },
    { label: "Growth", icon: <FaSeedling /> },
  ];

  return (
    <>
      {/* About Section */}
      <section className="relative py-14 sm:py-20 overflow-hidden" id="about">
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-amber-50/30"></div>
        <div className="absolute top-0 left-0 w-96 h-96 bg-[rgb(30,58,138)]/5 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-amber-400/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2"></div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Header */}
          <div className="mb-12 lg:mb-16" data-aos="fade-up">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-[2px] bg-[#a81724]"></div>
              <span className="text-[#a81724] text-sm font-semibold tracking-widest uppercase">About Us</span>
            </div>
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
              <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[rgb(30,58,138)] font-poppins leading-[1.1] max-w-3xl">
                Building futures through
                <span className="text-[#a81724]"> education</span> since 1994
              </h2>
              <p className="text-gray-500 text-base sm:text-lg leading-relaxed max-w-md lg:pb-2">
                For over <strong className="text-[rgb(30,58,138)] font-semibold">three decades</strong>,{" "}
                {ownerName} {entity ? "has" : "have"} built education
                on trust, values, and strong teacher-student bonds.
              </p>
            </div>
          </div>

          {/* Main Content */}
          <div className="grid lg:grid-cols-12 gap-6 lg:gap-8 items-stretch">

            {/* Left - Large image card with overlaid quote */}
            <div className="lg:col-span-5 relative" data-aos="fade-right">
              <div className="relative h-full min-h-[420px] sm:min-h-[520px]">
                <div className="absolute inset-0 rounded-[2rem] sm:rounded-[2.5rem] overflow-hidden shadow-2xl shadow-gray-400/30">
                  <img
                    src={mainImg}
                    alt={`About ${ownerName}`}
                    className="w-full h-full object-cover"
                  />
                  {/* Soft gradient for the quote card */}
                  <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/45 to-transparent"></div>

                  {/* Quote - glass card inside the image */}
                  <div className="absolute bottom-4 inset-x-4 sm:bottom-5 sm:inset-x-5 bg-white/85 backdrop-blur-md rounded-2xl p-4 sm:p-5 flex gap-3 items-start shadow-lg">
                    <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-[rgb(30,58,138)] to-[rgb(24,47,110)] flex items-center justify-center text-white">
                      <FaQuoteLeft className="w-3.5 h-3.5" />
                    </span>
                    <p className="text-sm sm:text-base text-gray-700 font-medium italic leading-relaxed">
                      "We create spaces where students learn with joy and teachers grow with purpose."
                    </p>
                  </div>
                </div>

                {/* Floating badge - top right */}
                <div className="absolute -top-4 -right-2 sm:-right-4 bg-white rounded-2xl shadow-xl shadow-gray-300/50 border border-gray-100 px-4 py-3 flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-[#a81724] flex items-center justify-center text-white">
                    <FaAward className="w-4 h-4" />
                  </span>
                  <div>
                    <p className="text-xl font-bold text-[rgb(30,58,138)] leading-none">
                      30<span className="text-[#a81724]">+</span>
                    </p>
                    <p className="text-gray-500 text-[11px] mt-0.5">Years of Excellence</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right - Bento tiles */}
            <div className="lg:col-span-7 flex flex-col gap-6" data-aos="fade-left">

              <div className="grid grid-cols-2 gap-4 sm:gap-5 flex-1">
                {/* Accent tile - teachers */}
                <div className="bg-gradient-to-br from-[rgb(30,58,138)] to-[rgb(24,47,110)] rounded-[1.75rem] p-6 sm:p-7 flex flex-col justify-between min-h-[170px] shadow-lg shadow-[rgb(30,58,138)]/20">
                  <span className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center text-white">
                    <FaChalkboardTeacher className="w-5 h-5" />
                  </span>
                  <div>
                    <p className="text-3xl sm:text-4xl font-bold text-white leading-none">
                      <CountUp end={4000} duration={2} separator="," enableScrollSpy scrollSpyOnce />
                      <span className="text-amber-400">+</span>
                    </p>
                    <p className="text-white/70 text-sm mt-1.5">Passionate Teachers</p>
                  </div>
                </div>

                {/* Second image tile */}
                <div className="rounded-[1.75rem] overflow-hidden shadow-lg shadow-gray-300/40 min-h-[170px]">
                  <img
                    src={aboutImg2}
                    alt="Growing together at our schools"
                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                  />
                </div>

                {/* Schools tile */}
                <div className="bg-white rounded-[1.75rem] border border-gray-100 p-6 sm:p-7 flex flex-col justify-between min-h-[170px] shadow-sm hover:shadow-lg transition-shadow duration-300">
                  <span className="w-11 h-11 rounded-xl bg-[#a81724]/8 flex items-center justify-center text-[#a81724]">
                    <FaSchool className="w-5 h-5" />
                  </span>
                  <div>
                    <p className="text-3xl sm:text-4xl font-bold text-[rgb(30,58,138)] leading-none">
                      <CountUp end={45} duration={2} enableScrollSpy scrollSpyOnce />
                      <span className="text-[#a81724]">+</span>
                    </p>
                    <p className="text-gray-500 text-sm mt-1.5">
                      {entity ? "Schools in Our Network" : "Schools, 2 Groups"}
                    </p>
                  </div>
                </div>

                {/* Awards tile */}
                <div className="bg-white rounded-[1.75rem] border border-gray-100 p-6 sm:p-7 flex flex-col justify-between min-h-[170px] shadow-sm hover:shadow-lg transition-shadow duration-300">
                  <span className="w-11 h-11 rounded-xl bg-amber-400/15 flex items-center justify-center text-amber-600">
                    <FaAward className="w-5 h-5" />
                  </span>
                  <div>
                    <p className="text-3xl sm:text-4xl font-bold text-[rgb(30,58,138)] leading-none">
                      <CountUp end={120} duration={2} enableScrollSpy scrollSpyOnce />
                      <span className="text-[#a81724]">+</span>
                    </p>
                    <p className="text-gray-500 text-sm mt-1.5">Awards &amp; Recognitions</p>
                  </div>
                </div>
              </div>

              {/* Bottom row: text + CTAs */}
              <div className="bg-white/70 backdrop-blur-sm border border-gray-100 rounded-[1.75rem] p-6 sm:p-7 shadow-sm flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-8">
                <p className="text-gray-600 text-base leading-relaxed flex-1">
                  If you believe in sincere teaching and meaningful learning, you'll feel
                  at home here. Join us in shaping the next generation.
                </p>
                <div className="flex flex-wrap items-center gap-3 flex-shrink-0">
                  <a
                    href="#job-openings"
                    className="inline-flex items-center gap-2 bg-[#a81724] text-white font-semibold px-6 py-3 rounded-full hover:bg-[#8a1420] transition-all duration-300 shadow-lg shadow-[#a81724]/20 text-sm"
                  >
                    <span>Explore Careers</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </a>
                  <a
                    href="#staff-benefits"
                    className="inline-flex items-center gap-2 text-[rgb(30,58,138)] font-semibold px-5 py-3 rounded-full border border-[rgb(30,58,138)]/15 hover:border-[rgb(30,58,138)]/40 hover:text-[#a81724] transition-colors group text-sm"
                  >
                    <span>View Benefits</span>
                    <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Our Core Values - chip strip */}
      <section className="bg-gradient-to-r from-[rgb(30,58,138)] via-[rgb(24,47,110)] to-[rgb(30,58,138)] py-8 sm:py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6">
            <span className="text-white/50 text-xs sm:text-sm font-semibold uppercase tracking-widest">
              Our Values
            </span>
            <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
              {values.map((value, index) => (
                <span
                  key={index}
                  className="inline-flex items-center gap-2 bg-white/10 border border-white/10 rounded-full px-4 sm:px-5 py-2 text-white text-sm sm:text-base font-medium hover:bg-white/15 transition-colors"
                >
                  <span className="text-amber-400 text-sm">{value.icon}</span>
                  {value.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default AboutSection;
