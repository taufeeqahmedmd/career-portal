import React from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay } from "swiper/modules";
import "swiper/css";
import bgImage from "../assets/bg-vision.jpg";

// Import awards from src/assets/awards/
import award1 from "../assets/awards/1.png";
import award2 from "../assets/awards/2.png";
import award3 from "../assets/awards/3.png";
import award4 from "../assets/awards/4.png";
import award5 from "../assets/awards/5.png";
import award6 from "../assets/awards/6.png";
import award7 from "../assets/awards/7.png";
import award8 from "../assets/awards/8.png";
import award9 from "../assets/awards/9.png";
import award10 from "../assets/awards/10.png";
import award11 from "../assets/awards/11.png";
import award12 from "../assets/awards/12.png";
import award13 from "../assets/awards/13.png";
import award14 from "../assets/awards/14.png";

const awards = [
  award1, award2, award3, award4, award5, award6, award7,
  award8, award9, award10, award11, award12, award13, award14,
];

const VisionMission = () => {
  return (
    <section
      className="relative bg-cover bg-center bg-fixed bg-no-repeat py-16 sm:py-20"
      style={{ backgroundImage: `url(${bgImage})` }}
      id="vision-mission"
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-[rgb(30,58,138)]/90"></div>

      {/* Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6">
        
        {/* Header */}
        <div className="text-center mb-10" data-aos="fade-up">
          <h2 className="text-3xl sm:text-4xl font-bold text-white font-poppins mb-2">
            Vision & Mission
          </h2>
          <p className="text-blue-200/60 text-sm sm:text-base">
            Guided by purpose, driven by passion
          </p>
        </div>

        {/* Vision & Mission - Minimal Inline Style */}
        <div className="flex flex-col md:flex-row items-stretch gap-6 mb-16 max-w-4xl mx-auto">
          
          {/* Vision */}
          <div className="flex-1 flex items-start gap-4 p-5 rounded-xl border border-white/15 bg-white/5" data-aos="fade-up">
            <div className="w-10 h-10 flex-shrink-0 bg-[#a81724] rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Our Vision</h3>
              <p className="text-blue-100/70 text-sm leading-relaxed">
                To create learners who grow with wisdom, compassion, and courage, supported by the best educational practices.
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="hidden md:block w-px bg-white/20"></div>
          
          {/* Mission */}
          <div className="flex-1 flex items-start gap-4 p-5 rounded-xl border border-white/15 bg-white/5" data-aos="fade-up" data-aos-delay="100">
            <div className="w-10 h-10 flex-shrink-0 bg-white rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-[rgb(30,58,138)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Our Mission</h3>
              <p className="text-blue-100/70 text-sm leading-relaxed">
                To provide education in a safe, inspiring space where curiosity is encouraged and potential is unlocked.
              </p>
            </div>
          </div>
        </div>

        {/* Awards Section */}
        <div data-aos="fade-up">
          
          {/* Awards Header */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="h-px w-12 bg-white/20"></div>
            <span className="text-white/80 font-medium text-sm uppercase tracking-wider">Awards & Recognitions</span>
            <div className="h-px w-12 bg-white/20"></div>
          </div>

          {/* Awards Carousel */}
          <Swiper
            modules={[Autoplay]}
            spaceBetween={16}
            slidesPerView={5}
            loop
            autoplay={{ delay: 2000, disableOnInteraction: false }}
            speed={600}
            breakpoints={{
              320: { slidesPerView: 3, spaceBetween: 12 },
              640: { slidesPerView: 4, spaceBetween: 14 },
              768: { slidesPerView: 5, spaceBetween: 16 },
              1024: { slidesPerView: 6, spaceBetween: 16 },
            }}
          >
            {awards.map((src, index) => (
              <SwiperSlide key={index}>
                <div className="bg-white rounded-lg p-3 h-16 sm:h-20 flex items-center justify-center">
                  <img
                    src={src}
                    alt={`Award ${index + 1}`}
                    className="h-full w-full object-contain"
                  />
                </div>
              </SwiperSlide>
            ))}
          </Swiper>
        </div>
      </div>
    </section>
  );
};

export default VisionMission;
