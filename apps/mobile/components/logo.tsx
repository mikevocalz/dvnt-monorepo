import * as React from "react";
import Svg, {
  SvgProps,
  Defs,
  LinearGradient,
  Stop,
  Path,
  Rect,
} from "react-native-svg";
/* SVGR has dropped some elements not supported by react-native-svg: style */

const Logo = (props: SvgProps) => (
  <Svg id="Layer_1" viewBox="0 0 2360 908" width={24} height={24} {...props}>
    <Defs>
      <LinearGradient
        id="linear-gradient"
        x1={924.9}
        x2={1289.2}
        y1={456}
        y2={456}
        gradientTransform="matrix(1 0 0 -1 0 910)"
        gradientUnits="userSpaceOnUse"
      >
        <Stop offset={0} stopColor="#0f4961" />
        <Stop offset={0} stopColor="#175b7b" />
        <Stop offset={0.1} stopColor="#217098" />
        <Stop offset={0.2} stopColor="#2981af" />
        <Stop offset={0.3} stopColor="#2f8ec1" />
        <Stop offset={0.5} stopColor="#3397ce" />
        <Stop offset={0.6} stopColor="#369cd5" />
        <Stop offset={1} stopColor="#379ed8" />
      </LinearGradient>
      <LinearGradient
        id="linear-gradient1"
        x1={873.7}
        x2={1174}
        y1={369.3}
        y2={369.3}
        gradientTransform="matrix(1 0 0 -1 0 910)"
        gradientUnits="userSpaceOnUse"
      >
        <Stop offset={0} stopColor="#0f4961" />
        <Stop offset={0} stopColor="#175b7b" />
        <Stop offset={0.1} stopColor="#217098" />
        <Stop offset={0.2} stopColor="#2981af" />
        <Stop offset={0.3} stopColor="#2f8ec1" />
        <Stop offset={0.5} stopColor="#3397ce" />
        <Stop offset={0.6} stopColor="#369cd5" />
        <Stop offset={1} stopColor="#379ed8" />
      </LinearGradient>
      <LinearGradient
        id="linear-gradient2"
        x1={822.8}
        x2={1057.6}
        y1={282.6}
        y2={282.6}
        gradientTransform="matrix(1 0 0 -1 0 910)"
        gradientUnits="userSpaceOnUse"
      >
        <Stop offset={0} stopColor="#0f4961" />
        <Stop offset={0} stopColor="#175b7b" />
        <Stop offset={0.1} stopColor="#217098" />
        <Stop offset={0.2} stopColor="#2981af" />
        <Stop offset={0.3} stopColor="#2f8ec1" />
        <Stop offset={0.5} stopColor="#3397ce" />
        <Stop offset={0.6} stopColor="#369cd5" />
        <Stop offset={1} stopColor="#379ed8" />
      </LinearGradient>
      <LinearGradient
        id="linear-gradient3"
        x1={703.4}
        x2={881}
        y1={343.5}
        y2={343.5}
        gradientTransform="matrix(1 0 0 -1 0 910)"
        gradientUnits="userSpaceOnUse"
      >
        <Stop offset={0} stopColor="#874e9f" />
        <Stop offset={0.3} stopColor="#824a9b" />
        <Stop offset={0.6} stopColor="#743f92" />
        <Stop offset={0.9} stopColor="#5d2d82" />
        <Stop offset={1} stopColor="#5b2c81" />
      </LinearGradient>
      <LinearGradient
        id="linear-gradient4"
        x1={651.7}
        x2={855.7}
        y1={309.1}
        y2={309.1}
        gradientTransform="matrix(1 0 0 -1 0 910)"
        gradientUnits="userSpaceOnUse"
      >
        <Stop offset={0} stopColor="#874e9f" />
        <Stop offset={0.3} stopColor="#824a9b" />
        <Stop offset={0.6} stopColor="#743f92" />
        <Stop offset={0.9} stopColor="#5d2d82" />
        <Stop offset={1} stopColor="#5b2c81" />
      </LinearGradient>
      <LinearGradient
        id="linear-gradient5"
        x1={600.7}
        x2={829.5}
        y1={282.6}
        y2={282.6}
        gradientTransform="matrix(1 0 0 -1 0 910)"
        gradientUnits="userSpaceOnUse"
      >
        <Stop offset={0} stopColor="#874e9f" />
        <Stop offset={0.3} stopColor="#824a9b" />
        <Stop offset={0.6} stopColor="#743f92" />
        <Stop offset={0.9} stopColor="#5d2d82" />
        <Stop offset={1} stopColor="#5b2c81" />
      </LinearGradient>
    </Defs>
    <Path
      d="M215.5 788.7h88.3c18.6 0 32.3-.5 40.9-1.7 49-6.8 93.5-32.1 121.3-72.5 17.6-25.6 27-55.6 27-87s-9.4-61.4-27-87c-27.8-40.5-72.3-65.8-121.2-72.6-8.7-1.2-22.3-1.8-40.9-1.7-26 0-55.4.1-88.3 0-.2 0-.4.2-.4.4V788.3c0 .2.2.4.4.4Z"
      fill="transparent"
    />
    <Path d="M842.5 855.5v-.4l-13 34.8 12.9-34.3Z" fill="none" />
    <Path
      d="M350.7 348.2c-9.6-.9-28.9-1.4-57.9-1.4H0v23.9h295.3c26.7 0 44.8.5 54.4 1.4C493 386.6 603.9 508.4 587.8 655.9c-7 64.1-38.9 122.5-88.1 163.9-49.9 42-113 64.2-178.2 64.3h-106c-.2 0-.4-.2-.4-.4v-23.1c0-.2.2-.3.4-.3h106.8c86-.2 168.6-44 212.5-118.8 32.8-56 39.6-124.2 18.9-185.8-31.2-92.8-118.8-154-215-160.4-16.1-1.1-34.9-.8-53.3-.8h-237c-.3 0-.5.2-.5.5v23.1c0 .2.2.4.4.4H320c53 0 103.6 17.3 144.9 50.6 49.3 39.7 78 99.7 76.6 163.2-2 89.4-62.3 163.5-145.5 191.7-17.2 5.8-35 9.6-53.2 11.4-8.2.8-25.4 1.1-51.6 1h-75.4c-.4 0-.7-.3-.7-.7v-22.9c0-.2.2-.4.4-.4h88.3c18.7.2 33.3-.4 43.7-1.7 60.5-7.6 115.1-40.7 146.3-93.8 26.3-44.7 31.1-100.4 13.7-149-25.1-70-89.1-115.3-161.9-124.3-8.7-1.1-23.9-1.6-45.7-1.5H96.1c-.2 0-.4.2-.4.4V908h23.8V466.6c0-.2.2-.5.5-.5h22.9c.3 0 .5.2.5.5v441.3h23.9V466.6c0-.3.2-.5.5-.5h22.8c.3 0 .5.2.5.5v441.3h137.7c6.1-.3 12.1-.8 18.1-1.3 31.7-2.6 62-9.9 90.8-21.9 61.9-25.8 113.7-71.8 144.7-131.3 40.3-77.4 40.7-169.5 2.5-247-44.7-90.6-135.7-148.7-234.3-158.4ZM215.1 627.4V466.6c0-19.4.2-.4.4-.4h88.3c18.6 0 32.3.5 40.9 1.7 49 6.8 93.4 32.1 121.2 72.6 17.6 25.6 27 55.6 27 87s-9.5 61.4-27 87c-27.8 40.5-72.3 65.8-121.3 72.5-8.7 1.2-22.3 1.8-40.9 1.7-26-.1-55.4-.1-88.3 0-.2 0-.4-.2-.4-.4V627.5Z"
      fill="#fff"
    />
    <Path
      d="M1289.2 0h-24.4c-.3.2-.6.4-.7.7C1151 303.1 1037.9 605.5 925 908h25.1L1289.1.9V.7c-.1-.4-.1-.6 0-.6Z"
      fill="url(#linear-gradient)"
    />
    <Path
      d="M1173.7 173.3h-24.8c-.4 0-.7.2-.8.6L873.7 908h25.7L1174 173.7c0-.2 0-.3-.2-.3Z"
      fill="url(#linear-gradient1)"
    />
    <Path
      d="M1057.4 346.7h-23.9c-.3 0-.6.2-.7.5l-128.4 342-61.9 165.9v.4l-12.9 34.3-6.8 18.1h24.7l210.1-561c0-.1 0-.3-.2-.3Z"
      fill="url(#linear-gradient2)"
    />
    <Path
      d="M728.9 347c0-.2-.2-.3-.4-.3H704c-.3 0-.6.3-.5.6 0 0 164.7 438.9 164.8 438.9 0 0 12.9-34.2 12.8-34.3L729 346.9Z"
      fill="url(#linear-gradient3)"
    />
    <Path
      d="M855.6 819.7c0 .1-.2.1-.2 0L677.8 347.1c0-.2-.3-.4-.5-.4H652c-.2 0-.3.2-.3.4l190.8 507.8v.2l13.2-35.3Z"
      fill="url(#linear-gradient4)"
    />
    <Path
      d="M828.9 889.8 627 347.1c0-.2-.3-.4-.6-.4h-25.5c-.2 0-.3.2-.2.4L810.8 908h11.9l6.8-18.1c-.2.2-.5.2-.6 0Z"
      fill="url(#linear-gradient5)"
    />
    <Path
      d="M1256.4 346.8h-22.8c-.3 0-.6.3-.6.6V908h23.9V347.4c0-.3-.3-.6-.6-.6ZM1304.3 346.8h-22.8c-.3 0-.6.3-.6.6v560.7h23.9V347.3c0-.3-.3-.6-.6-.6ZM1662.8 346.7h-23.2c-.2 0-.3.2-.3.4v415.2c0 .3-.4.4-.5.1l-224.2-415c-.2-.4-.7-.7-1.2-.7h-25.2c-.2 0-.4.2-.3.5l251 464.6c.2.4.3.9.3 1.3V858c0 .1-.2.2-.3 0l-280.5-510.8c-.2-.3-.5-.5-.8-.5H1329c-.1 0-.2 0-.2.2V908h23.8V477.3c0-.2.2-.3.3 0l233.8 430.8h27.9L1353 431.2c-.3-.5-.4-1.1-.4-1.6v-39c0-.2.3-.3.4-.1l286.3 517.6h23.8v-561c0-.2-.2-.4-.3-.4ZM1710.4 346.8h-22.7c-.3 0-.6.3-.6.6V908h23.8V347.3c0-.3-.2-.5-.5-.5ZM1758.2 346.8h-22.8c-.3 0-.5.2-.5.5v560.8h23.9V347.3c0-.3-.2-.5-.6-.5Z"
      fill="#fff"
    />
    <Rect
      width={525.6}
      height={23.9}
      x={1834.4}
      y={346.7}
      fill="#fff"
      rx={0.5}
      ry={0.5}
    />
    <Path
      d="M1834.9 394.4h476.7c.3 0 .5.2.5.5v22.9c0 .3-.2.5-.5.5h-476.7c-.3 0-.5-.2-.5-.5v-22.9c0-.3.2-.5.5-.5ZM2264 442.2h-429.2c-.2 0-.4.2-.4.4v23.2c0 .2.2.3.3.3h154.5c.3 0 .5.2.5.5V908h23.9V466.7c0-.3.3-.6.6-.6h22.7c.3 0 .6.3.6.6v441.2h23.9V466.6c0-.3.2-.5.5-.5h22.7c.3 0 .6.3.6.6V908h23.9V466.6c0-.3.2-.5.5-.5h154.5c.2 0 .3-.2.3-.4v-23.2c0-.2-.2-.4-.4-.4Z"
      fill="#fff"
    />
  </Svg>
);
export default Logo;
