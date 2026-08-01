import React, { useEffect, useState, useRef } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay } from "swiper/modules";
import { getPublicBranches, getPublicEntities } from "../services/api";

import imgAerocity from "../assets/branches/aerocity.jpg";
import imgAlwal from "../assets/branches/alwal.jpg";
import imgBowenpally from "../assets/branches/bowenpally.jpg";
import imgGandipet from "../assets/branches/gandipet.jpg";
import imgMahendrahills from "../assets/branches/mahendrahills.jpg";
import imgNacharam from "../assets/branches/nacharam.jpg";
import imgNadergul from "../assets/branches/nadergul.jpg";
import imgSagarroad from "../assets/branches/sagarroad.jpg";
import imgSantoshnagar from "../assets/branches/santoshnagar.jpg";
import imgSaroornagar from "../assets/branches/saroornagar.jpg";
import imgThumukunta from "../assets/branches/thumukunta.jpg";
import imgTirumalagiri from "../assets/branches/tirumalagiri.jpg";

const DEFAULT_ENTITY_COLOR = "#1e3a8a";

// Locality keyword -> campus photo
const BRANCH_IMAGES = {
  aerocity: imgAerocity,
  alwal: imgAlwal,
  bowenpally: imgBowenpally,
  gandipet: imgGandipet,
  mahendrahills: imgMahendrahills,
  nacharam: imgNacharam,
  nadergul: imgNadergul,
  sagarroad: imgSagarroad,
  santoshnagar: imgSantoshnagar,
  saroornagar: imgSaroornagar,
  saroornaagar: imgSaroornagar,
  thumukunta: imgThumukunta,
  tirumalagiri: imgTirumalagiri,
};

const FALLBACK_POOL = [imgAlwal, imgNacharam, imgGandipet, imgBowenpally];

const imageForBranch = (name, idx) => {
  const normalized = name.toLowerCase().replace(/[^a-z]/g, "");
  const match = Object.keys(BRANCH_IMAGES).find((key) => normalized.includes(key));
  return match ? BRANCH_IMAGES[match] : FALLBACK_POOL[idx % FALLBACK_POOL.length];
};

const OurBranches = ({ entity }) => {
  const [allBranches, setAllBranches] = useState([]);
  const [entityMap, setEntityMap] = useState({});
  const swiperRef = useRef(null);

  // On /dps and /pgos only that entity's branches are shown
  const branches = entity
    ? allBranches.filter((b) => b.school_group === entity.code)
    : allBranches;

  useEffect(() => {
    getPublicBranches()
      .then((res) => setAllBranches(res.data.branches))
      .catch(() => {});
    getPublicEntities()
      .then((res) => {
        const map = {};
        res.data.entities.forEach((en) => {
          map[en.code] = en;
        });
        setEntityMap(map);
      })
      .catch(() => {});
  }, []);

  const entityName = (code) => entityMap[code]?.name || code;
  const entityColor = (code) => entityMap[code]?.color || DEFAULT_ENTITY_COLOR;

  if (branches.length === 0) return null;

  const scrollToOpenings = () => {
    const el = document.getElementById("job-openings");
    if (el) {
      const offsetPosition = el.getBoundingClientRect().top + window.pageYOffset - 90;
      window.scrollTo({ top: offsetPosition, behavior: "smooth" });
    }
  };

  return (
    <section className="relative py-14 sm:py-20 overflow-hidden" id="our-branches">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-amber-50/30"></div>
      <div className="absolute top-0 right-0 w-96 h-96 bg-[rgb(30,58,138)]/5 rounded-full blur-3xl translate-x-1/2 -translate-y-1/2"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-amber-400/10 rounded-full blur-3xl -translate-x-1/2 translate-y-1/2"></div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="mb-10" data-aos="fade-up">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-[2px] bg-[#a81724]"></div>
            <span className="text-[#a81724] text-sm font-semibold tracking-widest uppercase">Where You Could Teach</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[rgb(30,58,138)] font-poppins">
            Our Branches
          </h2>
        </div>

        {/* Carousel - full-image cards with overlaid labels */}
        <div data-aos="fade-up">
          <Swiper
            modules={[Autoplay]}
            onSwiper={(swiper) => (swiperRef.current = swiper)}
            loop={branches.length > 4}
            grabCursor
            speed={700}
            spaceBetween={18}
            autoplay={{ delay: 3200, disableOnInteraction: false, pauseOnMouseEnter: true }}
            slidesPerView={1.15}
            breakpoints={{
              640: { slidesPerView: 2, spaceBetween: 18 },
              1024: { slidesPerView: 3, spaceBetween: 20 },
              1280: { slidesPerView: 4, spaceBetween: 20 },
            }}
          >
            {branches.map((branch, idx) => (
              <SwiperSlide key={branch.id}>
                <div className="group relative h-[340px] sm:h-[380px] rounded-[1.5rem] overflow-hidden shadow-lg shadow-gray-300/40">
                  <img
                    src={imageForBranch(branch.name, idx)}
                    alt={branch.name}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  />
                  {/* Bottom scrim */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent"></div>

                  {/* Group badge - only on the combined page, where it tells the cards apart */}
                  {!entity && (
                    <span
                      className="absolute top-3.5 left-3.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md bg-white/90"
                      style={{ color: entityColor(branch.school_group) }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: entityColor(branch.school_group) }}
                      ></span>
                      {entityName(branch.school_group)}
                    </span>
                  )}

                  {/* Overlaid details */}
                  <div className="absolute bottom-0 inset-x-0 p-5">
                    <p className="text-white font-bold text-base sm:text-lg font-poppins leading-snug">
                      {branch.name}
                    </p>
                    <p className={`text-sm mt-1 ${branch.openings_count > 0 ? "text-green-300" : "text-white/60"}`}>
                      {branch.openings_count > 0
                        ? `${branch.openings_count} open position${branch.openings_count !== 1 ? "s" : ""}`
                        : "No openings right now"}
                    </p>
                  </div>
                </div>
              </SwiperSlide>
            ))}
          </Swiper>

          {/* Bottom row: pill CTA left, round arrows right */}
          <div className="flex items-center justify-between mt-7">
            <button
              onClick={scrollToOpenings}
              className="inline-flex items-center gap-2 bg-[rgb(30,58,138)] hover:bg-[rgb(24,47,110)] text-white font-semibold text-sm sm:text-base px-7 sm:px-9 py-3.5 rounded-full transition-colors shadow-lg shadow-[rgb(30,58,138)]/20"
            >
              Explore Openings
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </button>

            <div className="flex items-center gap-2.5">
              <button
                onClick={() => swiperRef.current?.slidePrev()}
                aria-label="Previous branches"
                className="w-11 h-11 rounded-full bg-white border border-gray-200 text-gray-600 hover:border-[rgb(30,58,138)]/50 hover:text-[rgb(30,58,138)] flex items-center justify-center transition-colors shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={() => swiperRef.current?.slideNext()}
                aria-label="Next branches"
                className="w-11 h-11 rounded-full bg-[#a81724] hover:bg-[#8a1420] text-white flex items-center justify-center transition-colors shadow-md shadow-[#a81724]/25"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default OurBranches;
